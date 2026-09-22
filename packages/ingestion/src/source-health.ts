import type { SupabaseClient } from "@supabase/supabase-js";
import { emptySourceHealthState, recordSourceRun, classifySourceHealth, type SourceHealthState, type SourceHealthLevel } from "@dealradar/connectors";
import type { SourceDiagnostic } from "./aggregate-market-observations";

/**
 * Persistance + composition de `SourceHealthState` (LOT "Product History
 * UX + Source Health + Interactive Cancellation + Beta Readiness", section
 * 4) — `packages/connectors/src/market-intelligence/source-health-
 * tracker.ts` reste PUR (aucune I/O) ; ce fichier est le SEUL endroit de
 * `packages/ingestion` qui lit/écrit `source_health_state` (migration
 * 0025). Une ligne PAR SOURCE, jamais un historique complet.
 *
 * Isolation : un échec de lecture/écriture de santé ne doit JAMAIS faire
 * échouer l'agrégation/l'analyse elle-même — l'appelant (`orchestrate-
 * market-intelligence.ts`/`take-market-snapshot.ts`) isole ces appels dans
 * son propre try/catch, même discipline que la persistance d'observations.
 */

interface RawSourceHealthRow {
  source: string;
  enabled: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason_class: string | null;
  recent_latencies_ms: number[] | null;
  requests_used: number;
  total_estimated_cost_usd: number;
  consecutive_failures: number;
  aborted_count: number;
  timeout_count: number;
  observations_returned_total: number;
}

function fromRow(row: RawSourceHealthRow): SourceHealthState {
  return {
    source: row.source,
    enabled: row.enabled,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastFailureReasonClass: (row.last_failure_reason_class as SourceHealthState["lastFailureReasonClass"]) ?? null,
    recentLatenciesMs: row.recent_latencies_ms ?? [],
    requestsUsed: row.requests_used,
    totalEstimatedCostUsd: row.total_estimated_cost_usd,
    consecutiveFailures: row.consecutive_failures,
    abortedCount: row.aborted_count,
    timeoutCount: row.timeout_count,
    observationsReturnedTotal: row.observations_returned_total,
  };
}

function toRow(state: SourceHealthState): Record<string, unknown> {
  return {
    source: state.source,
    enabled: state.enabled,
    last_success_at: state.lastSuccessAt,
    last_failure_at: state.lastFailureAt,
    last_failure_reason_class: state.lastFailureReasonClass,
    recent_latencies_ms: state.recentLatenciesMs,
    requests_used: state.requestsUsed,
    total_estimated_cost_usd: state.totalEstimatedCostUsd,
    consecutive_failures: state.consecutiveFailures,
    aborted_count: state.abortedCount,
    timeout_count: state.timeoutCount,
    observations_returned_total: state.observationsReturnedTotal,
    updated_at: new Date().toISOString(),
  };
}

/** `sourceNames` absentes de la table reçoivent `emptySourceHealthState(name)` — jamais une ligne manquante traitée comme une erreur. */
export async function loadSourceHealthStates(supabase: SupabaseClient, sourceNames: readonly string[]): Promise<Record<string, SourceHealthState>> {
  const result: Record<string, SourceHealthState> = {};
  for (const name of sourceNames) result[name] = emptySourceHealthState(name);
  if (sourceNames.length === 0) return result;

  const { data, error } = await supabase.from("source_health_state").select("*").in("source", sourceNames);
  if (error) {
    throw new Error(`Lecture de l'état de santé des sources impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }
  for (const row of (data as RawSourceHealthRow[] | null) ?? []) {
    result[row.source] = fromRow(row);
  }
  return result;
}

/** Upsert idempotent d'UN état — l'appelant persiste chaque source individuellement après `updateSourceHealthFromDiagnostics` (jamais un batch qui masquerait une erreur partielle). */
export async function persistSourceHealthState(supabase: SupabaseClient, state: SourceHealthState): Promise<void> {
  const { error } = await supabase.from("source_health_state").upsert(toRow(state), { onConflict: "source" });
  if (error) {
    throw new Error(`Persistance de l'état de santé de la source "${state.source}" impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }
}

/**
 * Fonction PURE — replie chaque `SourceDiagnostic` d'un cycle d'agrégation
 * dans l'état de santé déjà chargé, via `recordSourceRun` (`@dealradar/
 * connectors`). `status: "aborted"` -> `aborted: true` (JAMAIS un échec) ;
 * `status: "timeout"` -> `timedOut: true` + `failureReasonClass: "timeout"`
 * (une vraie limite fournisseur) ; `status: "error"` -> échec de classe
 * `"unknown"` (`SourceDiagnostic` ne porte pas de classe structurée
 * aujourd'hui — jamais devinée plus précisément que ce que l'appelant sait
 * réellement).
 */
export function updateSourceHealthFromDiagnostics(
  states: Record<string, SourceHealthState>,
  diagnostics: readonly SourceDiagnostic[],
  asOf: string,
): Record<string, SourceHealthState> {
  const next = { ...states };
  for (const diagnostic of diagnostics) {
    const existing = next[diagnostic.source] ?? emptySourceHealthState(diagnostic.source);
    next[diagnostic.source] = recordSourceRun(existing, {
      source: diagnostic.source,
      success: diagnostic.status === "success",
      latencyMs: diagnostic.latencyMs,
      failureReasonClass: diagnostic.status === "timeout" ? "timeout" : diagnostic.status === "error" ? "unknown" : undefined,
      estimatedCostUsd: null,
      occurredAt: asOf,
      aborted: diagnostic.status === "aborted",
      timedOut: diagnostic.status === "timeout",
      observationsReturned: diagnostic.observationCount,
    });
  }
  return next;
}

/** Projection `Record<source, SourceHealthLevel>` — la forme attendue par `buildSourceSelectionPlan` (`source-selection-plan.ts`). */
export function toHealthLevels(states: Record<string, SourceHealthState>): Record<string, SourceHealthLevel> {
  const levels: Record<string, SourceHealthLevel> = {};
  for (const [name, state] of Object.entries(states)) levels[name] = classifySourceHealth(state);
  return levels;
}
