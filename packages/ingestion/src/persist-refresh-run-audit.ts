import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Persistance de l'audit durable d'un run de rafraîchissement (LOT "Real DB
 * Integration + Exact Budget Enforcement + Runtime Observability",
 * sections 6/7) — `market_refresh_runs`/`market_refresh_run_targets`
 * (migration 0024). UNIQUEMENT des métadonnées SÛRES (identifiants,
 * horodatages, compteurs, noms de source, classes de raison) — jamais un
 * secret, jamais un payload brut complet (retention-friendly).
 *
 * Un échec de CETTE persistance ne doit JAMAIS remonter comme une erreur
 * du lot de rafraîchissement lui-même — l'appelant (le runner) doit
 * l'isoler dans son propre `try/catch`, cette fonction ne le fait pas à sa
 * place (elle laisse l'erreur remonter normalement, pour que l'appelant
 * décide explicitement de l'isolation, jamais une absorption silencieuse
 * cachée ici).
 */
export interface RefreshRunTargetAuditInput {
  researchTargetId: number | null;
  productKey: string;
  claimedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  outcome: "succeeded" | "failed";
  failureReason: string | null;
  selectedSources: string[];
  skippedSourceReasons: Record<string, string>;
  observationsReturned: number;
  observationsPersisted: number;
  fxSkippedCount: number;
  identityConflictCount: number;
  nextRefreshAt: string | null;
  safeErrorClass: string | null;
}

export interface RefreshRunAuditInput {
  supabase: SupabaseClient;
  runKey: string;
  leaseOwner: string;
  startedAt: string;
  finishedAt: string;
  considered: number;
  claimed: number;
  succeeded: number;
  failed: number;
  observationsPersisted: number;
  targetCountsByOutcome: Record<string, number>;
  sourceCountsByStatus: Record<string, number>;
  errorClassCounts: Record<string, number>;
  elapsedMs: number;
  timedOut: boolean;
  budgetExhausted: boolean;
  targets: readonly RefreshRunTargetAuditInput[];
}

export interface RefreshRunAuditResult {
  runId: number;
  targetRowsInserted: number;
}

export async function persistRefreshRunAudit(input: RefreshRunAuditInput): Promise<RefreshRunAuditResult> {
  const { data: runRow, error: runError } = await input.supabase
    .from("market_refresh_runs")
    .upsert(
      {
        run_key: input.runKey,
        lease_owner: input.leaseOwner,
        started_at: input.startedAt,
        finished_at: input.finishedAt,
        considered: input.considered,
        claimed: input.claimed,
        succeeded: input.succeeded,
        failed: input.failed,
        observations_persisted: input.observationsPersisted,
        target_counts_by_outcome: input.targetCountsByOutcome,
        source_counts_by_status: input.sourceCountsByStatus,
        error_class_counts: input.errorClassCounts,
        elapsed_ms: input.elapsedMs,
        timed_out: input.timedOut,
        budget_exhausted: input.budgetExhausted,
      },
      { onConflict: "run_key" },
    )
    .select("id")
    .single();

  if (runError || !runRow) {
    throw new Error(`Persistance de l'audit de run impossible : ${(runError as { message?: string } | null)?.message ?? "erreur inconnue"}`);
  }
  const runId = (runRow as { id: number }).id;

  if (input.targets.length === 0) return { runId, targetRowsInserted: 0 };

  const targetRows = input.targets.map((t) => ({
    run_id: runId,
    research_target_id: t.researchTargetId,
    product_key: t.productKey,
    claimed_at: t.claimedAt,
    started_at: t.startedAt,
    finished_at: t.finishedAt,
    outcome: t.outcome,
    failure_reason: t.failureReason,
    selected_sources: t.selectedSources,
    skipped_source_reasons: t.skippedSourceReasons,
    observations_returned: t.observationsReturned,
    observations_persisted: t.observationsPersisted,
    fx_skipped_count: t.fxSkippedCount,
    identity_conflict_count: t.identityConflictCount,
    next_refresh_at: t.nextRefreshAt,
    safe_error_class: t.safeErrorClass,
  }));

  const { error: targetsError } = await input.supabase.from("market_refresh_run_targets").insert(targetRows);
  if (targetsError) {
    throw new Error(`Persistance de l'audit par cible impossible : ${(targetsError as { message?: string }).message ?? "erreur inconnue"}`);
  }

  return { runId, targetRowsInserted: targetRows.length };
}
