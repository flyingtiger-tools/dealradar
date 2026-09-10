import type { ProviderMatrixEntry, TcgBenchmarkExampleResult, TcgFieldAccuracy, TcgFieldName, TcgMatrixMetrics } from "./types";

const COMPARED_FIELDS: TcgFieldName[] = ["cardName", "setName", "collectorNumber", "language", "variant"];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Agrège les résultats d'UNE entrée de matrice (un couple provider/modèle)
 * sur tout le dataset — jamais mélangé avec une autre entrée (même règle
 * que `metrics/aggregate.ts` : ne jamais combiner des provenances
 * différentes). Chaque taux `null` documente explicitement "aucun exemple
 * évaluable", jamais un taux fabriqué sur un dénominateur vide.
 */
export function aggregateTcgMatrixMetrics(matrixEntry: ProviderMatrixEntry, results: TcgBenchmarkExampleResult[]): TcgMatrixMetrics {
  const examplesTotal = results.length;
  const successResults = results.filter((r) => r.outcome === "success");
  const successCount = successResults.length;

  const fieldAccuracy: TcgFieldAccuracy[] = COMPARED_FIELDS.map((field) => {
    const evaluable = successResults.filter((r) => field in r.fieldMatches);
    const correct = evaluable.filter((r) => r.fieldMatches[field] === true).length;
    return {
      field,
      evaluable: evaluable.length,
      correct,
      accuracy: evaluable.length === 0 ? null : correct / evaluable.length,
    };
  });

  const exactMatchable = successResults.filter((r) => Object.keys(r.fieldMatches).length > 0);
  const exactIdentificationAccuracy =
    exactMatchable.length === 0 ? null : exactMatchable.filter((r) => r.exactMatch).length / exactMatchable.length;

  const calibrationSamples = successResults.filter((r) => r.overallConfidence !== null);
  const confidenceCalibrationError =
    calibrationSamples.length === 0
      ? null
      : average(calibrationSamples.map((r) => Math.abs(r.overallConfidence! - (r.exactMatch ? 1 : 0))));

  const needsConfirmationRate = examplesTotal === 0 ? null : results.filter((r) => r.needsConfirmation).length / examplesTotal;
  const hallucinationRate = successCount === 0 ? null : successResults.filter((r) => r.hallucinated).length / successCount;

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const costs = results.map((r) => r.estimatedCostUsd).filter((c): c is number => c !== null);
  const estimatedCostUsdTotal = costs.length === 0 ? null : costs.reduce((sum, c) => sum + c, 0);

  return {
    matrixEntry,
    examplesTotal,
    successCount,
    providerErrorCount: results.filter((r) => r.outcome === "provider_error").length,
    invalidJsonCount: results.filter((r) => r.outcome === "invalid_json").length,
    invalidSchemaCount: results.filter((r) => r.outcome === "invalid_schema").length,
    exactIdentificationAccuracy,
    fieldAccuracy,
    confidenceCalibrationError,
    needsConfirmationRate,
    hallucinationRate,
    latencyMs: {
      avg: average(latencies),
      median: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    inputUnitsTotal: results.reduce((sum, r) => sum + r.inputUnits, 0),
    outputUnitsTotal: results.reduce((sum, r) => sum + r.outputUnits, 0),
    estimatedCostUsdTotal,
    costPerSuccessfulIdentificationUsd:
      estimatedCostUsdTotal === null || successCount === 0 ? null : estimatedCostUsdTotal / successCount,
  };
}
