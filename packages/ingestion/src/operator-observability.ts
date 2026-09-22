import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySourceHealth, type SourceHealthState } from "@dealradar/connectors";

/**
 * Couche de requêtes OPÉRATEUR en LECTURE SEULE (LOT "Data Quality
 * Calibration + Operator Observability + Mobile Market Insight Contract",
 * section 8) — agrège `market_refresh_runs`/`market_refresh_run_targets`
 * (migration 0024), `research_targets` (migration 0020/0021), et
 * `market_snapshot_summaries` (migration 0023) en résumés SÛRS : aucun
 * secret, aucune URL brute, aucune valeur de credential. AUCUNE écriture —
 * chaque fonction ici est un simple `select`, jamais un `insert`/`update`.
 */

export interface RecentRunSummary {
  runKey: string;
  startedAt: string;
  finishedAt: string | null;
  considered: number;
  claimed: number;
  succeeded: number;
  failed: number;
  timedOut: boolean;
  budgetExhausted: boolean;
}

export interface FailedTargetsByReasonEntry {
  reason: string;
  count: number;
}

export interface SourceErrorCountEntry {
  source: string;
  count: number;
}

export interface IdentityConflictProductEntry {
  productKey: string;
  conflictCount: number;
}

export interface SourceReadinessSummaryEntry {
  source: string;
  /** `"ready" | "missing_credentials" | "restricted" | "disabled_policy" | "license_required"` — voir `ActivationStatus`, `@dealradar/connectors`. Jamais recalculé ici : `packages/ingestion` reste sans dépendance à `process.env`, l'appelant (`apps/workers`) fournit ce diagnostic déjà résolu (voir `buildMarketSourcesFromEnv`). */
  readiness: string | undefined;
}

/**
 * Rollup de santé PAR SOURCE (LOT "Product History UX + Source Health +
 * Interactive Cancellation + Beta Readiness", section 10) — lu directement
 * depuis `source_health_state` (migration 0025), jamais recalculé ici
 * (voir `classifySourceHealth`, `@dealradar/connectors`, appliqué tel
 * quel). `abortedCount`/`timeoutCount` restent SÉPARÉS l'un de l'autre ET
 * de `consecutiveFailures` — un abandon opérateur/utilisateur n'a jamais
 * dégradé `healthLevel`.
 */
export interface SourceHealthRollupEntry {
  source: string;
  healthLevel: "healthy" | "degraded" | "unhealthy";
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  requestsUsed: number;
  abortedCount: number;
  timeoutCount: number;
  averageLatencyMs: number | null;
}

export interface OperatorObservabilitySummary {
  generatedAt: string;
  /** Simple passe-plat de ce que l'appelant a fourni (voir `GetOperatorObservabilitySummaryOptions.sourceReadiness`) — `[]` si non fourni, jamais recalculé ici. */
  sourceReadiness: SourceReadinessSummaryEntry[];
  recentRuns: RecentRunSummary[];
  runCount: number;
  /** Fraction 0–1 des runs récents dont `failed === 0` ET au moins une cible traitée — `null` si aucun run récent. */
  successRate: number | null;
  failedTargetsByReason: FailedTargetsByReasonEntry[];
  /** Compte de sources en STATUT `"error"` sur les cibles récentes (voir `market_refresh_run_targets.skipped_source_reasons`) — jamais une URL/valeur de credential. */
  sourceErrorCounts: SourceErrorCountEntry[];
  dueTargetCount: number;
  /** Cible due depuis plus de `overdueThresholdHours` (défaut 24h) au-delà de son échéance — jamais un simple "due", un retard réel. */
  overdueTargetCount: number;
  budgetExhaustedRunCount: number;
  timedOutRunCount: number;
  /** Observations persistées, sommées PAR JOUR sur les runs récents inspectés — clé `YYYY-MM-DD`. */
  observationsPersistedByDay: Record<string, number>;
  topUnresolvedIdentityConflictProducts: IdentityConflictProductEntry[];
  /** Rollup complet, une entrée par source connue de `source_health_state` (section 10). */
  sourceHealth: SourceHealthRollupEntry[];
  /** Sous-ensemble de `sourceHealth` dont `healthLevel !== "healthy"` — vue rapide, jamais recalculée différemment. */
  unhealthySources: string[];
  /** Cibles récentes dont `failure_reason === "run_deadline_exceeded"` — SÉPARÉ de `failedTargetsByReason` (qui reste, lui, exhaustif) pour que "abandon opérateur" ne soit jamais confondu visuellement avec une vraie panne fournisseur. */
  abortedTargetCount: number;
  /** Horodatage du dernier cycle RÉUSSI parmi les cibles récentes inspectées — `null` si aucun. */
  latestSuccessfulTargetAt: string | null;
  /** Nombre de PRODUITS distincts dont le dernier résumé de cycle connu a moins de `sparseHistoryObservationThreshold` (défaut 3) observations — approximation BORNÉE (voir `sparseHistorySampleLimit`), jamais un compte exhaustif garanti sur une base volumineuse. */
  sparseHistoryProductCount: number;
}

export interface GetOperatorObservabilitySummaryOptions {
  /** Nombre de runs récents à inspecter — défaut 20. */
  recentRunLimit?: number;
  /** Heures au-delà de l'échéance pour qu'une cible due soit considérée EN RETARD — défaut 24h. */
  overdueThresholdHours?: number;
  now?: () => Date;
  /** Diagnostics de préparation DÉJÀ résolus par l'appelant (ex. `buildMarketSourcesFromEnv().diagnostics`, `apps/workers`) — jamais recalculé ici, voir `SourceReadinessSummaryEntry`. */
  sourceReadiness?: SourceReadinessSummaryEntry[];
  /** Nombre d'observations en-dessous duquel un résumé de cycle compte comme "historique clairsemé" — défaut 3. */
  sparseHistoryObservationThreshold?: number;
  /** Nombre de résumés de cycle inspectés pour `sparseHistoryProductCount` — défaut 500, jamais une lecture illimitée. */
  sparseHistorySampleLimit?: number;
}

interface RawRunRow {
  run_key: string;
  started_at: string;
  finished_at: string | null;
  considered: number;
  claimed: number;
  succeeded: number;
  failed: number;
  timed_out: boolean;
  budget_exhausted: boolean;
}

interface RawRunTargetRow {
  product_key: string;
  outcome: string;
  failure_reason: string | null;
  skipped_source_reasons: Record<string, string> | null;
  observations_persisted: number;
  identity_conflict_count: number;
  finished_at: string | null;
}

interface RawResearchTargetRow {
  next_refresh_at: string | null;
  enabled: boolean;
}

interface RawSourceHealthRow {
  source: string;
  enabled: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  recent_latencies_ms: number[] | null;
  requests_used: number;
  consecutive_failures: number;
  aborted_count: number;
  timeout_count: number;
}

interface RawSnapshotSummaryObservationCountRow {
  product_key: string;
  observation_count: number;
}

/** Réutilise `classifySourceHealth` (`@dealradar/connectors`) — JAMAIS une seconde définition des seuils healthy/degraded/unhealthy ici, pour ne jamais diverger de `packages/connectors/src/market-intelligence/source-health-tracker.ts`. */
function toSourceHealthState(row: RawSourceHealthRow): SourceHealthState {
  return {
    source: row.source,
    enabled: row.enabled,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastFailureReasonClass: null,
    recentLatenciesMs: row.recent_latencies_ms ?? [],
    requestsUsed: row.requests_used,
    totalEstimatedCostUsd: 0,
    consecutiveFailures: row.consecutive_failures,
    abortedCount: row.aborted_count,
    timeoutCount: row.timeout_count,
    observationsReturnedTotal: 0,
  };
}

function averageOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export async function getOperatorObservabilitySummary(
  supabase: SupabaseClient,
  options: GetOperatorObservabilitySummaryOptions = {},
): Promise<OperatorObservabilitySummary> {
  const nowIso = (options.now?.() ?? new Date()).toISOString();
  const recentRunLimit = options.recentRunLimit ?? 20;
  const overdueThresholdHours = options.overdueThresholdHours ?? 24;

  const { data: runRows, error: runsError } = await supabase
    .from("market_refresh_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(recentRunLimit);
  if (runsError) throw new Error(`Lecture des runs récents impossible : ${(runsError as { message?: string }).message ?? "erreur inconnue"}`);

  const runs = ((runRows as RawRunRow[] | null) ?? []).map(
    (r): RecentRunSummary => ({
      runKey: r.run_key,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      considered: r.considered,
      claimed: r.claimed,
      succeeded: r.succeeded,
      failed: r.failed,
      timedOut: r.timed_out,
      budgetExhausted: r.budget_exhausted,
    }),
  );

  const runsWithActivity = runs.filter((r) => r.claimed > 0);
  const successRate = runsWithActivity.length > 0 ? runsWithActivity.filter((r) => r.failed === 0).length / runsWithActivity.length : null;
  const budgetExhaustedRunCount = runs.filter((r) => r.budgetExhausted).length;
  const timedOutRunCount = runs.filter((r) => r.timedOut).length;

  const runKeys = runs.map((r) => r.runKey);
  let failedTargetsByReason: FailedTargetsByReasonEntry[] = [];
  let sourceErrorCounts: SourceErrorCountEntry[] = [];
  let observationsPersistedByDay: Record<string, number> = {};
  let abortedTargetCount = 0;
  let latestSuccessfulTargetAt: string | null = null;
  const identityConflictByProduct = new Map<string, number>();

  if (runKeys.length > 0) {
    const { data: runIdRows, error: runIdError } = await supabase.from("market_refresh_runs").select("id, run_key").in("run_key", runKeys);
    if (runIdError) throw new Error(`Lecture des identifiants de run impossible : ${(runIdError as { message?: string }).message ?? "erreur inconnue"}`);
    const runIds = ((runIdRows as { id: number; run_key: string }[] | null) ?? []).map((r) => r.id);

    if (runIds.length > 0) {
      const { data: targetRows, error: targetsError } = await supabase.from("market_refresh_run_targets").select("*").in("run_id", runIds);
      if (targetsError) throw new Error(`Lecture des cibles de run impossible : ${(targetsError as { message?: string }).message ?? "erreur inconnue"}`);

      const targets = (targetRows as RawRunTargetRow[] | null) ?? [];

      const reasonCounts = new Map<string, number>();
      const sourceErrorCountsMap = new Map<string, number>();
      const dayCounts = new Map<string, number>();

      for (const t of targets) {
        if (t.outcome === "failed" && t.failure_reason) {
          reasonCounts.set(t.failure_reason, (reasonCounts.get(t.failure_reason) ?? 0) + 1);
          // Séparé (section 10) — un abandon opérateur/utilisateur ne doit
          // jamais se lire comme "une panne parmi d'autres" dans un tableau
          // de bord, même s'il reste aussi présent dans `failedTargetsByReason`
          // (celui-ci reste exhaustif, jamais amputé).
          if (t.failure_reason === "run_deadline_exceeded") abortedTargetCount += 1;
        }
        for (const source of Object.keys(t.skipped_source_reasons ?? {})) {
          sourceErrorCountsMap.set(source, (sourceErrorCountsMap.get(source) ?? 0) + 1);
        }
        if (t.finished_at) {
          const day = t.finished_at.slice(0, 10);
          dayCounts.set(day, (dayCounts.get(day) ?? 0) + t.observations_persisted);
        }
        if (t.outcome === "succeeded" && t.finished_at && (!latestSuccessfulTargetAt || t.finished_at > latestSuccessfulTargetAt)) {
          latestSuccessfulTargetAt = t.finished_at;
        }
        if (t.identity_conflict_count > 0) {
          identityConflictByProduct.set(t.product_key, (identityConflictByProduct.get(t.product_key) ?? 0) + t.identity_conflict_count);
        }
      }

      failedTargetsByReason = [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
      sourceErrorCounts = [...sourceErrorCountsMap.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
      observationsPersistedByDay = Object.fromEntries(dayCounts);
    }
  }

  const { data: dueTargetRows, error: dueError } = await supabase.from("research_targets").select("next_refresh_at, enabled").eq("enabled", true);
  if (dueError) throw new Error(`Lecture des cibles dues impossible : ${(dueError as { message?: string }).message ?? "erreur inconnue"}`);
  const enabledTargets = (dueTargetRows as RawResearchTargetRow[] | null) ?? [];
  const nowMs = Date.parse(nowIso);
  const dueTargetCount = enabledTargets.filter((t) => t.next_refresh_at === null || Date.parse(t.next_refresh_at) <= nowMs).length;
  const overdueTargetCount = enabledTargets.filter((t) => t.next_refresh_at !== null && nowMs - Date.parse(t.next_refresh_at) > overdueThresholdHours * 60 * 60 * 1000).length;

  const topUnresolvedIdentityConflictProducts = [...identityConflictByProduct.entries()]
    .map(([productKey, conflictCount]) => ({ productKey, conflictCount }))
    .sort((a, b) => b.conflictCount - a.conflictCount)
    .slice(0, 10);

  // Rollup de santé (section 10) — table entière (bornée naturellement par
  // le nombre de sources connues, jamais plus d'une dizaine de lignes),
  // JAMAIS filtrée par `recentRunLimit` (la santé reflète l'état ACTUEL,
  // pas seulement les runs récemment inspectés ci-dessus).
  const { data: healthRows, error: healthError } = await supabase.from("source_health_state").select("*");
  if (healthError) throw new Error(`Lecture de l'état de santé des sources impossible : ${(healthError as { message?: string }).message ?? "erreur inconnue"}`);
  const sourceHealth: SourceHealthRollupEntry[] = ((healthRows as RawSourceHealthRow[] | null) ?? []).map((row) => {
    const state = toSourceHealthState(row);
    return {
      source: row.source,
      healthLevel: classifySourceHealth(state),
      consecutiveFailures: row.consecutive_failures,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      requestsUsed: row.requests_used,
      abortedCount: row.aborted_count,
      timeoutCount: row.timeout_count,
      averageLatencyMs: averageOf(row.recent_latencies_ms ?? []),
    };
  });
  const unhealthySources = sourceHealth.filter((s) => s.healthLevel !== "healthy").map((s) => s.source);

  // Historique clairsemé (section 10) — échantillon BORNÉ (jamais toute la
  // table), compte de PRODUITS distincts dont le dernier résumé connu a
  // moins de `sparseHistoryObservationThreshold` observations.
  const sparseHistoryObservationThreshold = options.sparseHistoryObservationThreshold ?? 3;
  const sparseHistorySampleLimit = options.sparseHistorySampleLimit ?? 500;
  const { data: sparseRows, error: sparseError } = await supabase
    .from("market_snapshot_summaries")
    .select("product_key, observation_count")
    .order("cycle_at", { ascending: false })
    .limit(sparseHistorySampleLimit);
  if (sparseError) throw new Error(`Lecture des résumés de cycle (historique clairsemé) impossible : ${(sparseError as { message?: string }).message ?? "erreur inconnue"}`);
  const sparseProductKeys = new Set<string>();
  for (const row of (sparseRows as RawSnapshotSummaryObservationCountRow[] | null) ?? []) {
    if (row.observation_count < sparseHistoryObservationThreshold) sparseProductKeys.add(row.product_key);
  }

  return {
    generatedAt: nowIso,
    sourceReadiness: options.sourceReadiness ?? [],
    recentRuns: runs,
    runCount: runs.length,
    successRate,
    failedTargetsByReason,
    sourceErrorCounts,
    dueTargetCount,
    overdueTargetCount,
    budgetExhaustedRunCount,
    timedOutRunCount,
    observationsPersistedByDay,
    topUnresolvedIdentityConflictProducts,
    sourceHealth,
    unhealthySources,
    abortedTargetCount,
    latestSuccessfulTargetAt,
    sparseHistoryProductCount: sparseProductKeys.size,
  };
}
