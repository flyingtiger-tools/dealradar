import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkHistoricalEngineAvailability, queryDueResearchTargets } from "@dealradar/ingestion";
import { buildMarketSourcesFromEnv } from "../ingestion/market-source-factory";
import { logger } from "../logger";

/**
 * Rapport d'activation pré-Production, BORNÉ et EN LECTURE SEULE (LOT
 * "Interactive History + Generic Result UI + Full Cancellation + Pre-Prod
 * Activation Package", section 11) — un instantané JSON sûr à coller dans
 * un ticket/une revue avant d'envisager le Stage E de
 * `docs/market-data-activation-checklist.md` (déploiement d'un
 * scheduler), jamais une décision automatique elle-même.
 *
 * Garanties :
 *  - AUCUNE écriture, quelle que soit la configuration d'environnement ;
 *  - AUCUNE valeur de credential jamais imprimée — uniquement PRÉSENT/
 *    ABSENT par nom de variable (même discipline que `source-smoke-
 *    test.ts`/`computeEnvPresenceBySource`) ;
 *  - Railway/le worker de rafraîchissement n'ont PAS besoin d'être en
 *    ligne pour ce préflight — seules des lectures Supabase directes et
 *    des vérifications d'environnement PUR sont effectuées ;
 *  - si `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` sont absentes, les
 *    sous-systèmes qui dépendent de la base restent honnêtement
 *    `"NOT_TESTED"`, jamais devinés comme "READY" ou "BLOCKED".
 *
 * Usage : `pnpm --filter @dealradar/workers activation-preflight`
 */

export type SubsystemStatus = "READY" | "BLOCKED" | "NOT_TESTED";

export interface MigrationsSubsystem {
  status: SubsystemStatus;
  detail: string;
  /** Tables migrations 0018–0024 (`checkHistoricalEngineAvailability`) — `null` si non testé (pas de connexion DB). */
  tables: { table: string; available: boolean }[] | null;
  /** Migration 0017 (colonne `analysis_requests.category_slug`) — vérifiée séparément (pas une TABLE, une colonne). */
  categorySlugColumnAvailable: boolean | null;
}

export interface SourceReadinessEntry {
  source: string;
  readiness: string | undefined;
}

export interface AiProviderSubsystem {
  status: "READY" | "NOT_CONFIGURED" | "MISCONFIGURED";
  provider: string | null;
  /** Nom de la variable de clé attendue pour CE provider — jamais la valeur elle-même. */
  expectedKeyVar: string | null;
  keyPresent: boolean;
}

export interface DbIntegrationTestsSubsystem {
  status: "READY" | "NOT_CONFIGURED";
  detail: string;
}

export interface DueResearchTargetsSubsystem {
  status: SubsystemStatus;
  count: number | null;
}

export interface ActivationPreflightReport {
  generatedAt: string;
  subsystems: {
    migrations: MigrationsSubsystem;
    sourceReadiness: { status: SubsystemStatus; sources: SourceReadinessEntry[] };
    aiProvider: AiProviderSubsystem;
    dbIntegrationTests: DbIntegrationTestsSubsystem;
    dueResearchTargets: DueResearchTargetsSubsystem;
  };
  overall: "READY" | "BLOCKED" | "PARTIAL";
  notes: string[];
}

const AI_PROVIDER_KEY_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const CATEGORY_SLUG_COLUMN_CHECK_LIMIT = 0;

async function checkMigrations(db: SupabaseClient | null): Promise<MigrationsSubsystem> {
  if (!db) {
    return { status: "NOT_TESTED", detail: "Aucune connexion Supabase (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY absentes) — migrations 0017–0024 non vérifiables sans base.", tables: null, categorySlugColumnAvailable: null };
  }

  const historicalEngine = await checkHistoricalEngineAvailability(db);
  const { error: categorySlugError } = await db.from("analysis_requests").select("category_slug").limit(CATEGORY_SLUG_COLUMN_CHECK_LIMIT);
  const categorySlugColumnAvailable = !categorySlugError;

  const allAvailable = historicalEngine.allTablesAvailable && categorySlugColumnAvailable;
  return {
    status: allAvailable ? "READY" : "BLOCKED",
    detail: allAvailable
      ? "Toutes les migrations 0017–0024 requises sont appliquées (colonne + 8 tables)."
      : "Au moins une migration 0017–0024 requise est absente — voir `tables`/`categorySlugColumnAvailable` pour le détail exact.",
    tables: historicalEngine.tables,
    categorySlugColumnAvailable,
  };
}

function checkSourceReadiness(): { status: SubsystemStatus; sources: SourceReadinessEntry[] } {
  const { diagnostics } = buildMarketSourcesFromEnv();
  return { status: "READY", sources: diagnostics.map((d) => ({ source: d.name, readiness: d.readiness })) };
}

function checkAiProvider(): AiProviderSubsystem {
  const provider = process.env.AI_PROVIDER ?? null;
  if (!provider) return { status: "NOT_CONFIGURED", provider: null, expectedKeyVar: null, keyPresent: false };

  const expectedKeyVar = AI_PROVIDER_KEY_VARS[provider] ?? null;
  if (!expectedKeyVar) return { status: "MISCONFIGURED", provider, expectedKeyVar: null, keyPresent: false };

  const keyPresent = Boolean(process.env[expectedKeyVar]);
  return { status: keyPresent ? "READY" : "MISCONFIGURED", provider, expectedKeyVar, keyPresent };
}

function checkDbIntegrationTestsEnv(): DbIntegrationTestsSubsystem {
  // Présence UNIQUEMENT (jamais une comparaison de valeurs ici — cette
  // vérification approfondie, y compris le refus si identique à la
  // Production, reste la responsabilité de `packages/ingestion/src/
  // __tests__/db-integration/env.ts`, seul juge au moment de lancer les
  // tests eux-mêmes).
  const allowed = process.env.ALLOW_DB_INTEGRATION_TESTS === "true";
  const hasAll = Boolean(process.env.TEST_DATABASE_URL) && Boolean(process.env.TEST_DATABASE_SUPABASE_URL) && Boolean(process.env.TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY);
  const ready = allowed && hasAll;
  return {
    status: ready ? "READY" : "NOT_CONFIGURED",
    detail: ready
      ? "ALLOW_DB_INTEGRATION_TESTS=true et les 3 variables TEST_DATABASE_* sont présentes — les 5 tests Postgres réels peuvent s'exécuter (voir section 12 du lot, `pnpm --filter @dealradar/ingestion test`)."
      : "Tests d'intégration DB réels NON configurés dans CET environnement — les 5 tests concurrents restent SKIPPED, jamais une fausse réussite.",
  };
}

async function checkDueResearchTargets(db: SupabaseClient | null): Promise<DueResearchTargetsSubsystem> {
  if (!db) return { status: "NOT_TESTED", count: null };
  const due = await queryDueResearchTargets(db, { limit: 1000, now: new Date() });
  return { status: "READY", count: due.length };
}

function buildServiceClientIfConfigured(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function buildActivationPreflightReport(dbOverride?: SupabaseClient | null): Promise<ActivationPreflightReport> {
  const db = dbOverride !== undefined ? dbOverride : buildServiceClientIfConfigured();

  const [migrations, dueResearchTargets] = await Promise.all([checkMigrations(db), checkDueResearchTargets(db)]);
  const sourceReadiness = checkSourceReadiness();
  const aiProvider = checkAiProvider();
  const dbIntegrationTests = checkDbIntegrationTestsEnv();

  const blockers = [migrations.status === "BLOCKED", aiProvider.status === "MISCONFIGURED"].some(Boolean);
  const anyNotTested = migrations.status === "NOT_TESTED" || dueResearchTargets.status === "NOT_TESTED";
  const overall: ActivationPreflightReport["overall"] = blockers ? "BLOCKED" : anyNotTested ? "PARTIAL" : "READY";

  return {
    generatedAt: new Date().toISOString(),
    subsystems: { migrations, sourceReadiness, aiProvider, dbIntegrationTests, dueResearchTargets },
    overall,
    notes: [
      "Railway (le worker de rafraîchissement) n'a jamais besoin d'être en ligne pour ce préflight — uniquement des lectures Supabase directes et des vérifications d'environnement pur.",
      "Ce rapport ne déploie/n'active jamais rien lui-même — voir docs/market-data-activation-checklist.md (Stage A→E) pour la suite humaine décidée après lecture.",
      "'READY' sur aiProvider est optionnel : l'absence totale d'IA configurée (AI_PROVIDER absent) reste un repli déterministe valide, jamais un blocage du reste du pipeline.",
    ],
  };
}

// `pathToFileURL` (jamais une concaténation `file://${...}` manuelle) —
// normalise les séparateurs de chemin ET l'encodage, seule comparaison
// fiable ENTRE PLATEFORMES (la concaténation manuelle, utilisée par
// `source-smoke-test.ts`, échoue silencieusement sur Windows : les
// antislash de `process.argv[1]` ne correspondent jamais aux slashs
// attendus par `import.meta.url` — constaté en vérifiant ce script
// directement dans cette session).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildActivationPreflightReport()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = report.overall === "BLOCKED" ? 1 : 0;
    })
    .catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Rapport d'activation pré-Production en échec");
      process.exitCode = 1;
    });
}
