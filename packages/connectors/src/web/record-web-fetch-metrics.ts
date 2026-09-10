import type { WebFetchMetrics } from "./types";

/**
 * Petites fonctions pures d'accumulation — jamais une classe avec état
 * caché : l'appelant garde `WebFetchMetrics` explicitement et décide quand
 * le journaliser/l'exposer. PREPARED : aucun appelant réel dans ce lot.
 */
export function recordFetchSuccess(metrics: WebFetchMetrics, latencyMs: number): WebFetchMetrics {
  return { ...metrics, fetchSuccessCount: metrics.fetchSuccessCount + 1, latenciesMs: [...metrics.latenciesMs, latencyMs] };
}

export function recordFetchFailure(metrics: WebFetchMetrics, options: { blocked?: boolean } = {}): WebFetchMetrics {
  return {
    ...metrics,
    fetchFailureCount: metrics.fetchFailureCount + 1,
    blockedCount: options.blocked ? metrics.blockedCount + 1 : metrics.blockedCount,
  };
}

export function recordParsingOutcome(
  metrics: WebFetchMetrics,
  options: { success: boolean; missingPrice?: boolean; missingTitle?: boolean; parseDrift?: boolean },
): WebFetchMetrics {
  return {
    ...metrics,
    parsingSuccessCount: options.success ? metrics.parsingSuccessCount + 1 : metrics.parsingSuccessCount,
    parsingFailureCount: options.success ? metrics.parsingFailureCount : metrics.parsingFailureCount + 1,
    missingPriceCount: options.missingPrice ? metrics.missingPriceCount + 1 : metrics.missingPriceCount,
    missingTitleCount: options.missingTitle ? metrics.missingTitleCount + 1 : metrics.missingTitleCount,
    parseDriftCount: options.parseDrift ? metrics.parseDriftCount + 1 : metrics.parseDriftCount,
  };
}
