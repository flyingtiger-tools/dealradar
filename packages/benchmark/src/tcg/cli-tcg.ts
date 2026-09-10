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

export type TcgCliResult = { kind: "empty_dataset"; datasetArg: string } | { kind: "report"; report: TcgBenchmarkReport };

/**
 * Point d'entrée `--tcg` du CLI benchmark (Phase 6/7, ADR 0013) — logique
 * pure, aucune sortie console ici (voir `cli.ts`, seul fichier de ce
 * package exempté de `no-console`, pour l'affichage). Mode simulé garanti
 * par défaut (`--tcg-live` requis explicitement pour tenter un run réel, ET
 * une clé valide pour le provider concerné — voir `provider-matrix.ts`) —
 * COÛT = 0 tant que ce flag n'est pas fourni.
 */
export async function runTcgCli(argv: string[], datasetsDir: string): Promise<TcgCliResult> {
  const datasetArg = argv.find((a) => a.startsWith("--tcg-dataset="))?.split("=")[1] ?? "tcg";
  const matrix = parseMatrixArg(argv.find((a) => a.startsWith("--tcg-providers="))?.split("=")[1]);
  const live = argv.includes("--tcg-live");

  const datasetPath = path.join(datasetsDir, "tcg", `${datasetArg}.json`);
  const dataset = loadTcgDataset(datasetPath);

  if (dataset.entries.length === 0) {
    return { kind: "empty_dataset", datasetArg };
  }

  const report = await runTcgBenchmark(dataset, matrix, {
    live,
    resolveImageUrl: (imagePath) => `file://${resolveTcgImagePath(datasetPath, imagePath)}`,
  });

  return { kind: "report", report };
}
