import { SOURCE_READINESS_MATRIX, resolveSourceReadiness } from "@dealradar/connectors";
import type { IdentityHints } from "@dealradar/ingestion";
import { pathToFileURL } from "node:url";
import { buildCatalogSourcesFromEnv, createCatalogLookup } from "../ingestion/catalog-source-factory";
import { logger } from "../logger";

/**
 * Harnais d'activation / test de fumée PAR SOURCE CATALOGUE (LOT "Live
 * Identity Enrichment + Barcode-First + upc.dev Fallback + Railway
 * Readiness", section 8) — pendant DÉDIÉ de `source-smoke-test.ts` (sources
 * de MARCHÉ) pour les Catalog Connectors (`open_food_facts`,
 * `open_products_facts`, `wikidata`, `rebrickable`, `upcdev`) : hints
 * d'identité EXACTS (`{barcode}`/`{legoSetNumber}`), jamais une recherche
 * floue par mot-clé. Réutilise `createCatalogLookup` TEL QUEL (même
 * traduction de hints que le pipeline réel, `enrich-product-identity.ts`),
 * jamais une seconde logique de traduction divergente.
 *
 * Usage :
 *   pnpm --filter @dealradar/workers catalog-smoke-test -- --source open_food_facts --category general --barcode 3017620422003
 *   pnpm --filter @dealradar/workers catalog-smoke-test -- --source rebrickable --category lego --lego-set 10300
 *   pnpm --filter @dealradar/workers catalog-smoke-test -- --source upcdev --category general --barcode 049000042566
 *
 * Comportement garanti (même discipline que `source-smoke-test.ts`) :
 *   - AUCUNE valeur de credential jamais imprimée (uniquement PRÉSENT/ABSENT
 *     par nom de variable via les diagnostics de `buildCatalogSourcesFromEnv`) ;
 *   - refuse une source verrouillée par POLITIQUE (ex. `igdb`) même si des
 *     credentials sont présentes — jamais outrepassé sans changement de
 *     politique DANS LE CODE (`source-readiness-matrix.ts`) ;
 *   - AUCUNE écriture en base Production — ce script n'écrit jamais dans
 *     Supabase ;
 *   - codes de sortie déterministes :
 *       0 succès (un match exact trouvé) · 2 credentials manquantes ·
 *       3 verrouillé par politique · 4 aucun hint fourni ·
 *       5 panne réseau/fournisseur · 6 aucun match exact trouvé.
 */

export const EXIT_SUCCESS = 0;
export const EXIT_MISSING_CREDENTIALS = 2;
export const EXIT_POLICY_BLOCKED = 3;
export const EXIT_NO_HINT = 4;
export const EXIT_NETWORK_FAILURE = 5;
export const EXIT_NO_MATCH = 6;

export class SmokeTestExit extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

interface ParsedArgs {
  source: string;
  categorySlug: string;
  hints: IdentityHints;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let source: string | undefined;
  let categorySlug: string | undefined;
  const hints: IdentityHints = {};

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--source") source = argv[i + 1];
    else if (argv[i] === "--category") categorySlug = argv[i + 1];
    else if (argv[i] === "--barcode") hints.barcode = argv[i + 1] ?? null;
    else if (argv[i] === "--lego-set") hints.legoSetNumber = argv[i + 1] ?? null;
    else if (argv[i] === "--gaming-title") hints.gamingTitle = argv[i + 1] ?? null;
  }

  if (!source) throw new Error("--source requis (ex. --source open_food_facts). Usage : --source <nom> --category <slug> [--barcode <code>] [--lego-set <numéro>] [--gaming-title <titre>]");
  if (!categorySlug) throw new Error("--category requis (ex. --category general).");
  if (!hints.barcode && !hints.legoSetNumber && !hints.gamingTitle) {
    throw new SmokeTestExit(EXIT_NO_HINT, "Au moins un indice EXACT requis (--barcode / --lego-set / --gaming-title) — une source catalogue n'accepte jamais une recherche floue par mot-clé.");
  }

  return { source, categorySlug, hints };
}

export function refuseIfPolicyLocked(sourceName: string): void {
  const descriptor = SOURCE_READINESS_MATRIX.find((d) => d.source === sourceName);
  if (!descriptor) return; // source hors matrice — laissé au chemin normal (diagnostics `buildCatalogSourcesFromEnv`).

  const envPresence: Record<string, boolean> = {};
  for (const envVar of descriptor.requiredEnvVars) envPresence[envVar] = Boolean(process.env[envVar]);
  const readiness = resolveSourceReadiness(descriptor, envPresence);

  if (readiness === "restricted" || readiness === "disabled_policy" || readiness === "license_required" || !descriptor.productionAllowed) {
    throw new SmokeTestExit(
      EXIT_POLICY_BLOCKED,
      `Source catalogue "${sourceName}" verrouillée par la politique de préparation (statut : "${readiness}", productionAllowed=${descriptor.productionAllowed}) — refus explicite, aucun test de fumée sans un changement de politique DANS LE CODE (source-readiness-matrix.ts).`,
    );
  }
}

async function run(args: ParsedArgs): Promise<number> {
  refuseIfPolicyLocked(args.source);

  const { sources, diagnostics } = buildCatalogSourcesFromEnv();
  if (!sources.has(args.source)) {
    const diagnostic = diagnostics.find((d) => d.name === args.source);
    throw new SmokeTestExit(
      EXIT_MISSING_CREDENTIALS,
      `Source catalogue "${args.source}" non construite depuis l'environnement (readiness=${diagnostic?.readiness ?? "inconnue"}) — credentials absentes. Aucune valeur de credential impliquée dans ce message.`,
    );
  }

  const lookup = createCatalogLookup(sources);
  const startedAtMs = Date.now();
  let status: "success" | "error" = "success";
  let errorMessage: string | null = null;
  let matches: Awaited<ReturnType<typeof lookup>> = [];
  try {
    matches = await lookup(args.source, args.hints, args.categorySlug);
  } catch (error) {
    status = "error";
    errorMessage = error instanceof Error ? error.message : "erreur inconnue";
  }
  const latencyMs = Date.now() - startedAtMs;

  const summary = {
    source: args.source,
    categorySlug: args.categorySlug,
    status,
    error: errorMessage,
    latencyMs,
    matchCount: matches.length,
    matches: matches.map((m) => ({ confidence: m.confidence, matchedOn: m.matchedOn, name: m.item.name, canonicalAttributes: m.item.canonicalAttributes })),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (status === "error") return EXIT_NETWORK_FAILURE;
  if (matches.length === 0) return EXIT_NO_MATCH;
  return EXIT_SUCCESS;
}

// Même garde-fou `pathToFileURL` que `source-smoke-test.ts` (jamais une
// concaténation `file://${...}` manuelle, fiable sous Windows).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    return run(args);
  })()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      if (error instanceof SmokeTestExit) {
        logger.error({ error: error.message, code: error.code }, "Test de fumée de source catalogue en échec");
        process.exitCode = error.code;
        return;
      }
      logger.error({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Test de fumée de source catalogue en échec");
      process.exitCode = 1;
    });
}
