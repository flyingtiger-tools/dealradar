import { MIN_OVERALL_CONFIDENCE_FOR_AUTO_CORROBORATION } from "@dealradar/ai";
import type { TcgDatasetTag } from "./dataset-schema";
import type { ProviderMatrixEntry, TcgBenchmarkExampleResult, TcgFieldAccuracy, TcgFieldName, TcgMatrixMetrics, TcgTagMetrics } from "./types";

const COMPARED_FIELDS: TcgFieldName[] = ["cardName", "setName", "collectorNumber", "language", "variant"];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Une entrée par tag réellement présent dans `results` — jamais les 12 tags possibles fabriqués à 0/0 (voir `TcgTagMetrics`). */
function aggregateByTag(results: TcgBenchmarkExampleResult[]): TcgTagMetrics[] {
  const byTag = new Map<TcgDatasetTag, TcgBenchmarkExampleResult[]>();
  for (const result of results) {
    for (const tag of result.tags) {
      const group = byTag.get(tag) ?? [];
      group.push(result);
      byTag.set(tag, group);
    }
  }

  return [...byTag.entries()].map(([tag, tagResults]) => {
    const successes = tagResults.filter((r) => r.outcome === "success");
    const exactMatchable = successes.filter((r) => Object.keys(r.fieldMatches).length > 0);
    return {
      tag,
      examplesTotal: tagResults.length,
      successCount: successes.length,
      exactIdentificationAccuracy: exactMatchable.length === 0 ? null : exactMatchable.filter((r) => r.exactMatch).length / exactMatchable.length,
    };
  });
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

  const providerErrorCount = results.filter((r) => r.outcome === "provider_error").length;
  const invalidJsonCount = results.filter((r) => r.outcome === "invalid_json").length;
  const invalidSchemaCount = results.filter((r) => r.outcome === "invalid_schema").length;

  // Seuil réel d'auto-corroboration (source de vérité unique, @dealradar/ai) — jamais un
  // second seuil deviné ici pour définir "confiance élevée" vs "confiance insuffisante".
  const highConfidenceSuccesses = successResults.filter(
    (r) => r.overallConfidence !== null && r.overallConfidence >= MIN_OVERALL_CONFIDENCE_FOR_AUTO_CORROBORATION,
  );
  const falsePositiveRate = rate(highConfidenceSuccesses.filter((r) => !r.exactMatch).length, highConfidenceSuccesses.length);

  const lowConfidenceSuccesses = successResults.filter(
    (r) => r.overallConfidence !== null && r.overallConfidence < MIN_OVERALL_CONFIDENCE_FOR_AUTO_CORROBORATION,
  );
  const falseNegativeRate = rate(lowConfidenceSuccesses.filter((r) => r.exactMatch).length, lowConfidenceSuccesses.length);

  // Restreint aux exemples où une comparaison était réellement possible (mêmes règles que
  // `exactMatchable` ci-dessus) — sinon un exemple "ambiguous" sans champ comparable
  // compterait à tort comme un échec (exactMatch est structurellement false quand rien
  // n'est comparable, voir run-tcg-example.ts).
  const ambiguousComparable = successResults.filter((r) => r.tags.includes("ambiguous") && Object.keys(r.fieldMatches).length > 0);
  const ambiguityRate = rate(ambiguousComparable.filter((r) => !r.exactMatch).length, ambiguousComparable.length);

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const costs = results.map((r) => r.estimatedCostUsd).filter((c): c is number => c !== null);
  const estimatedCostUsdTotal = costs.length === 0 ? null : costs.reduce((sum, c) => sum + c, 0);

  return {
    matrixEntry,
    examplesTotal,
    successCount,
    providerErrorCount,
    invalidJsonCount,
    invalidSchemaCount,
    providerErrorRate: rate(providerErrorCount, examplesTotal),
    invalidResponseRate: rate(invalidJsonCount + invalidSchemaCount, examplesTotal),
    exactIdentificationAccuracy,
    fieldAccuracy,
    confidenceCalibrationError,
    needsConfirmationRate,
    hallucinationRate,
    falsePositiveRate,
    falseNegativeRate,
    ambiguityRate,
    hybridSuccessRate: rate(successCount, examplesTotal),
    byTag: aggregateByTag(results),
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
