import path from "node:path";
import { loadTcgDataset, resolveTcgImagePath } from "./load-tcg-dataset";
import { runTcgBenchmark } from "./run-tcg-benchmark";
import type { ProviderMatrixEntry, TcgBenchmarkReport } from "./types";

/**
 * Matrice par défaut du CLI — mêmes modèles par défaut que
 * `apps/workers/src/ingestion/ai-provider-config.ts::DEFAULT_MODEL_BY_PROVIDER`,
 * dupliqués intentionnellement (packages/benchmark ne dépend jamais de
 * apps/workers). Remplaçable via `--tcg-providers=`.
 */
const DEFAULT_MATRIX: ProviderMatrixEntry[] = [
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "openrouter", model: "openai/gpt-4o-mini" },
];

function parseMatrixArg(value: string | undefined): ProviderMatrixEntry[] {
  if (!value) return DEFAULT_MATRIX;
  return value.split(",").map((pair) => {
    const [provider, model] = pair.split(":");
    if (!provider || !model || !["openai", "anthropic", "groq", "openrouter"].includes(provider)) {
      throw new Error(`--tcg-providers invalide : "${pair}" (attendu "provider:model", provider ∈ openai|anthropic|groq|openrouter).`);
    }
    return { provider: provider as ProviderMatrixEntry["provider"], model };
  });
}

export type TcgCliResult =
  | { kind: "empty_dataset"; datasetArg: string }
  | { kind: "report"; report: TcgBenchmarkReport }
  /** `--tcg-live` demandé sans les garde-fous obligatoires (Phase 16/17) — RIEN n'a été exécuté, aucun appel réseau, aucune clé lue. */
  | { kind: "live_blocked"; reasons: string[] };

const DEFAULT_LIVE_MAX_EXAMPLES_CAP = 20;

/**
 * Garde-fous obligatoires avant un run `--tcg-live` (Phase 16, "préparer le
 * terrain sans jamais l'exécuter") — objectif explicite : rendre impossible
 * un benchmark payant lancé PAR ERREUR. Chaque condition manquante est
 * rapportée précisément, jamais un simple refus muet. Ne vérifie PAS la
 * présence d'une clé réelle par provider (déjà géré par
 * `provider-matrix.ts::buildProviderForMatrixEntry`, qui replie
 * silencieusement sur le simulé si la clé du provider concerné est
 * absente) — ce garde-fou-ci porte sur l'INTENTION explicite de
 * l'utilisateur, pas sur la disponibilité technique d'une clé.
 */
function checkLiveGuards(argv: string[], matrix: readonly ProviderMatrixEntry[]): string[] {
  const reasons: string[] = [];

  if (!argv.includes("--confirm-live-cost")) {
    reasons.push('"--tcg-live" seul ne suffit jamais : ajouter "--confirm-live-cost" pour confirmer explicitement qu\'un coût réel est accepté.');
  }

  const maxExamplesArg = argv.find((a) => a.startsWith("--tcg-max-examples="))?.split("=")[1];
  if (maxExamplesArg === undefined) {
    reasons.push(`Un run live exige "--tcg-max-examples=<n>" (n > 0, ex. ${DEFAULT_LIVE_MAX_EXAMPLES_CAP}) — jamais un run sans plafond explicite du nombre d'exemples.`);
  } else {
    const parsed = Number(maxExamplesArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      reasons.push(`"--tcg-max-examples=${maxExamplesArg}" invalide — doit être un entier strictement positif.`);
    }
  }

  // "--tcg-providers=" explicite est déjà obligatoire pour s'écarter de DEFAULT_MATRIX
  // dans un usage normal, mais un run live doit choisir provider ET modèle sans
  // ambiguïté — vérifie qu'aucune entrée de la matrice n'est vide/mal formée (défense
  // en profondeur, parseMatrixArg() lève déjà si le format est invalide).
  if (matrix.length === 0) {
    reasons.push("Aucune entrée de matrice provider/modèle — un run live doit cibler au moins un provider explicite.");
  }

  return reasons;
}

/**
 * Point d'entrée `--tcg` du CLI benchmark (Phase 6/7, ADR 0013) — logique
 * pure, aucune sortie console ici (voir `cli.ts`, seul fichier de ce
 * package exempté de `no-console`, pour l'affichage). Mode simulé garanti
 * par défaut (`--tcg-live` requis explicitement pour tenter un run réel, ET
 * une clé valide pour le provider concerné — voir `provider-matrix.ts`) —
 * COÛT = 0 tant que ce flag n'est pas fourni.
 *
 * Un `--tcg-live` sans `--confirm-live-cost` ET `--tcg-max-examples=<n>`
 * explicites est REFUSÉ avant même de charger le dataset ou de construire un
 * provider (Phase 16/17) — voir `checkLiveGuards()`.
 */
export async function runTcgCli(argv: string[], datasetsDir: string): Promise<TcgCliResult> {
  const datasetArg = argv.find((a) => a.startsWith("--tcg-dataset="))?.split("=")[1] ?? "tcg";
  const matrix = parseMatrixArg(argv.find((a) => a.startsWith("--tcg-providers="))?.split("=")[1]);
  const live = argv.includes("--tcg-live");

  if (live) {
    const reasons = checkLiveGuards(argv, matrix);
    if (reasons.length > 0) return { kind: "live_blocked", reasons };
  }

  const datasetPath = path.join(datasetsDir, "tcg", `${datasetArg}.json`);
  const dataset = loadTcgDataset(datasetPath);

  if (dataset.entries.length === 0) {
    return { kind: "empty_dataset", datasetArg };
  }

  const maxExamplesArg = argv.find((a) => a.startsWith("--tcg-max-examples="))?.split("=")[1];
  const maxExamples = maxExamplesArg !== undefined ? Number(maxExamplesArg) : undefined;

  const report = await runTcgBenchmark(dataset, matrix, {
    live,
    maxExamples,
    resolveImageUrl: (imagePath) => `file://${resolveTcgImagePath(datasetPath, imagePath)}`,
  });

  return { kind: "report", report };
}
