import { describe, expect, it } from "vitest";
import { aggregateTcgMatrixMetrics } from "../aggregate-tcg-metrics";
import type { TcgBenchmarkExampleResult } from "../types";

const MATRIX_ENTRY = { provider: "openai" as const, model: "gpt-4o-mini" };

function successResult(overrides: Partial<TcgBenchmarkExampleResult> = {}): TcgBenchmarkExampleResult {
  return {
    exampleId: "x",
    tags: [],
    matrixEntry: MATRIX_ENTRY,
    actualProviderName: "openai",
    outcome: "success",
    fieldMatches: { cardName: true, setName: true, collectorNumber: true },
    exactMatch: true,
    overallConfidence: 0.9,
    hallucinated: false,
    needsConfirmation: false,
    inputUnits: 100,
    outputUnits: 20,
    estimatedCostUsd: 0.001,
    latencyMs: 200,
    ...overrides,
  };
}

describe("aggregateTcgMatrixMetrics — dénominateurs vides -> null, jamais un taux fabriqué", () => {
  it("aucun exemple : tous les taux sont null, comptes à zéro", () => {
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, []);
    expect(metrics.examplesTotal).toBe(0);
    expect(metrics.exactIdentificationAccuracy).toBeNull();
    expect(metrics.needsConfirmationRate).toBeNull();
    expect(metrics.hallucinationRate).toBeNull();
    expect(metrics.confidenceCalibrationError).toBeNull();
    expect(metrics.estimatedCostUsdTotal).toBeNull();
    expect(metrics.costPerSuccessfulIdentificationUsd).toBeNull();
  });

  it("aucun exemple avec coût connu : estimatedCostUsdTotal null même si des exemples existent", () => {
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, [successResult({ estimatedCostUsd: null })]);
    expect(metrics.estimatedCostUsdTotal).toBeNull();
    expect(metrics.costPerSuccessfulIdentificationUsd).toBeNull();
  });
});

describe("aggregateTcgMatrixMetrics — comptes et taux", () => {
  it("compte les issues par catégorie", () => {
    const results: TcgBenchmarkExampleResult[] = [
      successResult(),
      successResult({ outcome: "provider_error", fieldMatches: {}, exactMatch: false }),
      successResult({ outcome: "invalid_json", fieldMatches: {}, exactMatch: false }),
      successResult({ outcome: "invalid_schema", fieldMatches: {}, exactMatch: false }),
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.examplesTotal).toBe(4);
    expect(metrics.successCount).toBe(1);
    expect(metrics.providerErrorCount).toBe(1);
    expect(metrics.invalidJsonCount).toBe(1);
    expect(metrics.invalidSchemaCount).toBe(1);
  });

  it("exactIdentificationAccuracy sur les succès uniquement", () => {
    const results = [successResult({ exactMatch: true }), successResult({ exactMatch: false })];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.exactIdentificationAccuracy).toBe(0.5);
  });

  it("fieldAccuracy par champ, dénominateur = exemples où le champ était évaluable", () => {
    const results = [
      successResult({ fieldMatches: { cardName: true, setName: false } }),
      successResult({ fieldMatches: { cardName: true } }),
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    const cardName = metrics.fieldAccuracy.find((f) => f.field === "cardName")!;
    const setName = metrics.fieldAccuracy.find((f) => f.field === "setName")!;
    expect(cardName).toEqual({ field: "cardName", evaluable: 2, correct: 2, accuracy: 1 });
    expect(setName).toEqual({ field: "setName", evaluable: 1, correct: 0, accuracy: 0 });
  });

  it("needsConfirmationRate sur TOUS les exemples (y compris les échecs, comptés comme nécessitant confirmation)", () => {
    const results = [
      successResult({ needsConfirmation: false }),
      successResult({ outcome: "provider_error", needsConfirmation: true, fieldMatches: {}, exactMatch: false }),
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.needsConfirmationRate).toBe(0.5);
  });

  it("hallucinationRate sur les succès uniquement", () => {
    const results = [successResult({ hallucinated: true }), successResult({ hallucinated: false })];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.hallucinationRate).toBe(0.5);
  });

  it("coût total = somme des coûts non-null uniquement, coût par identification réussie divise par successCount", () => {
    const results = [
      successResult({ estimatedCostUsd: 0.002 }),
      successResult({ estimatedCostUsd: 0.004 }),
      successResult({ outcome: "provider_error", estimatedCostUsd: null, fieldMatches: {}, exactMatch: false }),
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.estimatedCostUsdTotal).toBeCloseTo(0.006, 10);
    expect(metrics.costPerSuccessfulIdentificationUsd).toBeCloseTo(0.003, 10);
  });

  it("latences : avg/median/p95 calculées sur tous les exemples", () => {
    const results = [10, 20, 30, 40, 50].map((latencyMs) => successResult({ latencyMs }));
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.latencyMs.avg).toBe(30);
    expect(metrics.latencyMs.median).toBe(30);
  });
});
