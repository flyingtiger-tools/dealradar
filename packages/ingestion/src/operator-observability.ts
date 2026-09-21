import type { SupabaseClient } from "@supabase/supabase-js";

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
}

export interface GetOperatorObservabilitySummaryOptions {
  /** Nombre de runs récents à inspecter — défaut 20. */
  recentRunLimit?: number;
  /** Heures au-delà de l'échéance pour qu'une cible due soit considérée EN RETARD — défaut 24h. */
  overdueThresholdHours?: number;
  now?: () => Date;
  /** Diagnostics de préparation DÉJÀ résolus par l'appelant (ex. `buildMarketSourcesFromEnv().diagnostics`, `apps/workers`) — jamais recalculé ici, voir `SourceReadinessSummaryEntry`. */
  sourceReadiness?: SourceReadinessSummaryEntry[];
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
        }
        for (const source of Object.keys(t.skipped_source_reasons ?? {})) {
          sourceErrorCountsMap.set(source, (sourceErrorCountsMap.get(source) ?? 0) + 1);
        }
        if (t.finished_at) {
          const day = t.finished_at.slice(0, 10);
          dayCounts.set(day, (dayCounts.get(day) ?? 0) + t.observations_persisted);
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
  };
}
