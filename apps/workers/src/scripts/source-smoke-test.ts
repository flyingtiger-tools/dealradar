import { buildSearchPlans, createCanonicalProductIdentity, mergeIdentityEvidence, KNOWN_SOURCE_QUERY_PROFILES, type IdentityField } from "@dealradar/core";
import { SOURCE_READINESS_MATRIX, resolveSourceReadiness } from "@dealradar/connectors";
import { buildMarketSourcesFromEnv } from "../ingestion/market-source-factory";
import { logger } from "../logger";

/**
 * Harnais d'activation / test de fumée PAR SOURCE (LOT "Close the Refresh
 * Loop + Operational Hardening + Activation Harness", section 11) — teste
 * SÛREMENT une seule source configurée à la fois, sans jamais écrire en
 * Production ni imprimer une valeur de credential.
 *
 * Usage :
 *   pnpm --filter @dealradar/workers smoke-test -- --source bricklink --category lego --field bricklinkNo=10300
 *   pnpm --filter @dealradar/workers smoke-test -- --source keepa --category apple --field asin=B0XXXXX --dry-run
 *
 * Comportement garanti :
 *   - nom de source obligatoire ;
 *   - une entrée d'identité/requête obligatoire (au moins un `--field`) ;
 *   - AUCUNE valeur de credential jamais imprimée (uniquement PRÉSENT/ABSENT
 *     par nom de variable, voir `buildMarketSourcesFromEnv` réutilisé tel quel) ;
 *   - une recherche RÉSEAU BORNÉE au plus (timeout dur), jamais plus ;
 *   - résumé SÛR uniquement : succès/erreur, latence, nombre d'observations,
 *     types de preuve, devises, CHAMPS d'identifiants vus (jamais un dump
 *     brut), nombre de marchands/sources distincts ;
 *   - `--dry-run` : affiche le SearchPlan (source, requête, indices) SANS
 *     appel réseau ;
 *   - refuse une source verrouillée par POLITIQUE (restricted/disabled_policy/
 *     license_required) même si des credentials sont présentes — jamais
 *     outrepassé sans un changement de politique explicite dans le code
 *     (`source-readiness-matrix.ts`) ;
 *   - AUCUNE écriture en base Production par défaut — ce script n'écrit
 *     jamais dans Supabase, quelle que soit la configuration d'environnement.
 */

const SMOKE_TEST_TIMEOUT_MS = 15_000;

interface ParsedArgs {
  source: string;
  categorySlug: string;
  fields: Partial<Record<IdentityField, string>>;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let source: string | undefined;
  let categorySlug: string | undefined;
  let dryRun = false;
  const fields: Partial<Record<IdentityField, string>> = {};

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") source = argv[i + 1];
    else if (argv[i] === "--category") categorySlug = argv[i + 1];
    else if (argv[i] === "--dry-run") dryRun = true;
    else if (argv[i] === "--field") {
      const raw = argv[i + 1] ?? "";
      const eqIndex = raw.indexOf("=");
      if (eqIndex > 0) {
        const key = raw.slice(0, eqIndex) as IdentityField;
        const value = raw.slice(eqIndex + 1);
        if (key && value) fields[key] = value;
      }
    }
  }

  if (!source) throw new Error('--source requis (ex. --source bricklink). Usage : --source <nom> --category <slug> --field <champ=valeur> [--dry-run]');
  if (!categorySlug) throw new Error("--category requis (ex. --category lego).");
  if (Object.keys(fields).length === 0) throw new Error("Au moins un --field <champ=valeur> requis (ex. --field bricklinkNo=10300) — une entrée d'identité/requête est obligatoire.");

  return { source, categorySlug, fields, dryRun };
}

export function refuseIfPolicyLocked(sourceName: string): void {
  const descriptor = SOURCE_READINESS_MATRIX.find((d) => d.source === sourceName);
  if (!descriptor) return; // source hors matrice — jamais bloquée ici, laissé au chemin normal (diagnostics `buildMarketSourcesFromEnv`).

  const envPresence: Record<string, boolean> = {};
  for (const envVar of descriptor.requiredEnvVars) envPresence[envVar] = Boolean(process.env[envVar]);
  const readiness = resolveSourceReadiness(descriptor, envPresence);

  if (readiness === "restricted" || readiness === "disabled_policy" || readiness === "license_required" || !descriptor.productionAllowed) {
    throw new Error(
      `Source "${sourceName}" verrouillée par la politique de préparation (statut : "${readiness}", productionAllowed=${descriptor.productionAllowed}) — refus explicite, aucun test de fumée sans un changement de politique DANS LE CODE (source-readiness-matrix.ts). Jamais outrepassé par une simple variable d'environnement.`,
    );
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Délai de ${timeoutMs}ms dépassé — recherche bornée abandonnée.`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  refuseIfPolicyLocked(args.source);

  const identity = mergeIdentityEvidence(createCanonicalProductIdentity(args.categorySlug), {
    source: "smoke_test_cli",
    confidence: 1,
    observedAt: new Date().toISOString(),
    fields: args.fields,
  }).identity;

  const plans = buildSearchPlans(identity, KNOWN_SOURCE_QUERY_PROFILES);
  const plan = plans.find((p) => p.source === args.source);
  if (!plan) {
    throw new Error(`Aucun plan de requête pour "${args.source}" avec les champs fournis — vérifier --field / le profil de requête connu pour cette source.`);
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ mode: "dry-run", source: args.source, categorySlug: args.categorySlug, query: plan.q, hints: plan.hints, exactness: plan.exactness }, null, 2));
    return;
  }

  const { sources, diagnostics } = buildMarketSourcesFromEnv();
  const source = sources.find((s) => s.source === args.source);
  if (!source) {
    const diagnostic = diagnostics.find((d) => d.name === args.source);
    throw new Error(
      `Source "${args.source}" non construite depuis l'environnement (readiness=${diagnostic?.readiness ?? "inconnue"}) — credentials absentes, catégorie non couverte, ou verrouillée par politique. Aucune valeur de credential impliquée dans ce message.`,
    );
  }

  const startedAtMs = Date.now();
  let status: "success" | "error" = "success";
  let errorMessage: string | null = null;
  let observations: Awaited<ReturnType<typeof source.search>>["observations"] = [];
  try {
    const result = await withTimeout(source.search({ categorySlug: args.categorySlug, q: plan.q, hints: plan.hints }), SMOKE_TEST_TIMEOUT_MS);
    observations = result.observations;
  } catch (error) {
    status = "error";
    errorMessage = error instanceof Error ? error.message : "erreur inconnue";
  }
  const latencyMs = Date.now() - startedAtMs;

  const evidenceTypes = [...new Set(observations.map((o) => o.evidenceType))];
  const currencies = [...new Set(observations.map((o) => o.currency))];
  const identifierFieldsSeen = [...new Set(observations.flatMap((o) => Object.keys(o.identifiers)))];
  const merchants = [...new Set(observations.map((o) => o.marketplace))];

  const summary = {
    source: args.source,
    categorySlug: args.categorySlug,
    status,
    error: errorMessage,
    latencyMs,
    observationCount: observations.length,
    evidenceTypes,
    currenciesObserved: currencies,
    identifierFieldsSeen,
    merchantCount: merchants.length,
    merchants,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (status === "error") process.exitCode = 1;
}

// Ne s'exécute que lorsque ce fichier est lancé directement (tsx) — jamais au simple `import` (permet aux tests d'importer `parseArgs`/`refuseIfPolicyLocked` sans déclencher `main()`).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Test de fumée de source en échec");
    process.exit(1);
  });
}
