/**
 * Métadonnées d'exécution légères par source (LOT "Multi-Source Market
 * Intelligence Foundation", section "guardrails coût/santé") — jamais un
 * système de facturation : seulement de quoi permettre à un appelant
 * (l'agrégateur, ou une future UI d'admin) de préférer les sources
 * gratuites/saines en premier, sans coder cette préférence en dur par nom
 * de source (voir `source-routing.ts`, qui consomme ces stats de façon
 * générique).
 *
 * Fonctions pures sur un état immuable — aucun état global, aucun
 * effet de bord, jamais un singleton partagé implicitement entre appels
 * (l'appelant est responsable de conserver l'objet `SourceHealthState`
 * entre deux appels s'il veut un historique).
 */

export type FailureReasonClass = "timeout" | "rate_limited" | "auth" | "not_found" | "invalid_response" | "network" | "unknown";

export interface SourceRunRecord {
  source: string;
  /** `true` = appel réussi (a produit au moins un résultat exploitable ou une réponse valide vide), `false` = échec. */
  success: boolean;
  latencyMs: number;
  /** `undefined` si `success`. */
  failureReasonClass?: FailureReasonClass;
  /** Estimation de coût en USD si la source expose assez d'information pour la calculer (ex. tarif par requête connu) — `null` sinon, jamais une valeur inventée. */
  estimatedCostUsd: number | null;
  occurredAt: string;
}

export interface SourceHealthState {
  source: string;
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReasonClass: FailureReasonClass | null;
  /** Fenêtre glissante des dernières latences (ms), la plus récente en dernier — bornée par l'appelant via `recordRun` (voir `MAX_LATENCY_SAMPLES`). */
  recentLatenciesMs: number[];
  requestsUsed: number;
  totalEstimatedCostUsd: number;
}

const MAX_LATENCY_SAMPLES = 20;

export function emptySourceHealthState(source: string): SourceHealthState {
  return {
    source,
    enabled: true,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReasonClass: null,
    recentLatenciesMs: [],
    requestsUsed: 0,
    totalEstimatedCostUsd: 0,
  };
}

/** Jamais une mutation de `state` — retourne toujours un nouvel objet (mêmes garanties d'immutabilité que `record-web-fetch-metrics.ts`, déjà en place). */
export function recordSourceRun(state: SourceHealthState, run: SourceRunRecord): SourceHealthState {
  const recentLatenciesMs = [...state.recentLatenciesMs, run.latencyMs].slice(-MAX_LATENCY_SAMPLES);
  return {
    ...state,
    lastSuccessAt: run.success ? run.occurredAt : state.lastSuccessAt,
    lastFailureAt: run.success ? state.lastFailureAt : run.occurredAt,
    lastFailureReasonClass: run.success ? state.lastFailureReasonClass : (run.failureReasonClass ?? "unknown"),
    recentLatenciesMs,
    requestsUsed: state.requestsUsed + 1,
    totalEstimatedCostUsd: state.totalEstimatedCostUsd + (run.estimatedCostUsd ?? 0),
  };
}

export function averageLatencyMs(state: SourceHealthState): number | null {
  if (state.recentLatenciesMs.length === 0) return null;
  return state.recentLatenciesMs.reduce((sum, v) => sum + v, 0) / state.recentLatenciesMs.length;
}

/** `true` uniquement si `state.enabled` ET que le dernier événement connu est un succès (ou qu'aucun événement n'a encore eu lieu — jamais désactivée sans preuve d'échec). */
export function isSourceHealthy(state: SourceHealthState): boolean {
  if (!state.enabled) return false;
  if (!state.lastFailureAt) return true;
  if (!state.lastSuccessAt) return false;
  return state.lastSuccessAt > state.lastFailureAt;
}

export function disableSource(state: SourceHealthState): SourceHealthState {
  return { ...state, enabled: false };
}

export function enableSource(state: SourceHealthState): SourceHealthState {
  return { ...state, enabled: true };
}
