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
  /** `true` = appel réussi (a produit au moins un résultat exploitable ou une réponse valide vide), `false` = échec. Ignoré si `aborted` (voir plus bas). */
  success: boolean;
  latencyMs: number;
  /** `undefined` si `success`. */
  failureReasonClass?: FailureReasonClass;
  /** Estimation de coût en USD si la source expose assez d'information pour la calculer (ex. tarif par requête connu) — `null` sinon, jamais une valeur inventée. */
  estimatedCostUsd: number | null;
  occurredAt: string;
  /**
   * `true` UNIQUEMENT pour un abandon par un signal EXTERNE (déadline de
   * run, annulation utilisateur — LOT "Product History UX + Source Health +
   * Interactive Cancellation + Beta Readiness", section 4) — JAMAIS pour
   * une vraie panne fournisseur. NEUTRE pour la santé : `consecutiveFailures`/
   * `lastFailureAt`/`lastFailureReasonClass` restent tous INCHANGÉS (règle
   * absolue : "explicit runner/user abort MUST NOT reduce source health").
   * Compté séparément dans `abortedCount`, jamais confondu avec un échec.
   */
  aborted?: boolean;
  /** `true` pour un dépassement de délai PAR SOURCE (jamais un abandon opérateur/utilisateur) — compte comme un échec de santé (politique documentée : le timeout est un signal fournisseur réel, distinct d'une annulation). */
  timedOut?: boolean;
  /** Nombre d'observations retournées par CET appel — `0` par défaut, jamais un total cumulé recalculé ici. */
  observationsReturned?: number;
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
  /**
   * Compteur de RÉCUPÉRATION GRADUELLE (section 4 : "one successful request
   * can recover health gradually, not necessarily instantly") — +1 par
   * échec/timeout, -1 (jamais sous 0) par succès, INCHANGÉ par un abandon
   * opérateur/utilisateur. Alimente `classifySourceHealth` : un seul succès
   * après plusieurs échecs consécutifs ne restaure JAMAIS instantanément
   * "healthy", il faut autant de succès que d'échecs accumulés.
   */
  consecutiveFailures: number;
  /** Nombre TOTAL d'abandons opérateur/utilisateur — jamais compté comme un échec (voir `SourceRunRecord.aborted`). */
  abortedCount: number;
  /** Nombre TOTAL de dépassements de délai PAR SOURCE — distinct de `abortedCount`. */
  timeoutCount: number;
  observationsReturnedTotal: number;
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
    consecutiveFailures: 0,
    abortedCount: 0,
    timeoutCount: 0,
    observationsReturnedTotal: 0,
  };
}

/** Jamais une mutation de `state` — retourne toujours un nouvel objet (mêmes garanties d'immutabilité que `record-web-fetch-metrics.ts`, déjà en place). */
export function recordSourceRun(state: SourceHealthState, run: SourceRunRecord): SourceHealthState {
  const recentLatenciesMs = [...state.recentLatenciesMs, run.latencyMs].slice(-MAX_LATENCY_SAMPLES);
  const observationsReturnedTotal = state.observationsReturnedTotal + (run.observationsReturned ?? 0);
  const totalEstimatedCostUsd = state.totalEstimatedCostUsd + (run.estimatedCostUsd ?? 0);
  const requestsUsed = state.requestsUsed + 1;

  if (run.aborted) {
    // Abandon opérateur/utilisateur — NEUTRE, jamais un échec ni une
    // récupération (voir l'en-tête de `SourceRunRecord.aborted`). Seuls les
    // compteurs de VOLUME (requêtes/latence/coût/observations/abandons)
    // évoluent ; tout ce qui reflète la SANTÉ reste identique.
    return { ...state, recentLatenciesMs, requestsUsed, totalEstimatedCostUsd, observationsReturnedTotal, abortedCount: state.abortedCount + 1 };
  }

  const consecutiveFailures = run.success ? Math.max(0, state.consecutiveFailures - 1) : state.consecutiveFailures + 1;

  return {
    ...state,
    lastSuccessAt: run.success ? run.occurredAt : state.lastSuccessAt,
    lastFailureAt: run.success ? state.lastFailureAt : run.occurredAt,
    lastFailureReasonClass: run.success ? state.lastFailureReasonClass : (run.failureReasonClass ?? "unknown"),
    recentLatenciesMs,
    requestsUsed,
    totalEstimatedCostUsd,
    observationsReturnedTotal,
    consecutiveFailures,
    timeoutCount: state.timeoutCount + (run.timedOut ? 1 : 0),
  };
}

export type SourceHealthLevel = "healthy" | "degraded" | "unhealthy";

const DEGRADED_AT_CONSECUTIVE_FAILURES = 1;
const UNHEALTHY_AT_CONSECUTIVE_FAILURES = 3;

/**
 * Classification à 3 niveaux (section 4/5) — DISTINCTE de `isSourceHealthy`
 * (booléen historique, jamais modifié pour ne pas casser ses appelants
 * existants) : celle-ci reflète la récupération GRADUELLE via
 * `consecutiveFailures` plutôt qu'un simple "dernier événement". Une
 * source désactivée (`enabled: false`) est toujours `"unhealthy"`, quel
 * que soit son historique.
 */
export function classifySourceHealth(state: SourceHealthState): SourceHealthLevel {
  if (!state.enabled) return "unhealthy";
  if (state.consecutiveFailures >= UNHEALTHY_AT_CONSECUTIVE_FAILURES) return "unhealthy";
  if (state.consecutiveFailures >= DEGRADED_AT_CONSECUTIVE_FAILURES) return "degraded";
  return "healthy";
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
