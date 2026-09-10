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

describe("aggregateTcgMatrixMetrics — providerErrorRate / invalidResponseRate", () => {
  it("providerErrorRate et invalidResponseRate sur TOUS les exemples (dénominateur = examplesTotal)", () => {
    const results = [
      successResult(),
      successResult({ outcome: "provider_error", fieldMatches: {}, exactMatch: false }),
      successResult({ outcome: "invalid_json", fieldMatches: {}, exactMatch: false }),
      successResult({ outcome: "invalid_schema", fieldMatches: {}, exactMatch: false }),
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.providerErrorRate).toBe(0.25);
    expect(metrics.invalidResponseRate).toBe(0.5); // invalid_json + invalid_schema
  });

  it("dataset vide : providerErrorRate et invalidResponseRate null, jamais 0 fabriqué", () => {
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, []);
    expect(metrics.providerErrorRate).toBeNull();
    expect(metrics.invalidResponseRate).toBeNull();
  });
});

describe("aggregateTcgMatrixMetrics — falsePositiveRate / falseNegativeRate (seuil réel MIN_OVERALL_CONFIDENCE_FOR_AUTO_CORROBORATION = 0.7)", () => {
  it("falsePositiveRate : parmi les succès de confiance >= 0.7, proportion faux", () => {
    const results = [
      successResult({ overallConfidence: 0.9, exactMatch: true }),
      successResult({ overallConfidence: 0.8, exactMatch: false }), // confiance élevée mais faux
      successResult({ overallConfidence: 0.5, exactMatch: false }), // confiance basse, hors dénominateur
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.falsePositiveRate).toBe(0.5); // 1/2 des succès de confiance >= 0.7 sont faux
  });

  it("falseNegativeRate : parmi les succès de confiance < 0.7, proportion juste", () => {
    const results = [
      successResult({ overallConfidence: 0.5, exactMatch: true }), // confiance insuffisante mais juste
      successResult({ overallConfidence: 0.6, exactMatch: false }),
      successResult({ overallConfidence: 0.9, exactMatch: true }), // confiance suffisante, hors dénominateur
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.falseNegativeRate).toBe(0.5);
  });

  it("aucun succès de confiance suffisante/insuffisante : null, jamais 0 fabriqué", () => {
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, []);
    expect(metrics.falsePositiveRate).toBeNull();
    expect(metrics.falseNegativeRate).toBeNull();
  });
});

describe("aggregateTcgMatrixMetrics — ambiguityRate", () => {
  it("proportion des exemples tagués \"ambiguous\" dont exactMatch est faux", () => {
    const results = [
      successResult({ tags: ["ambiguous"], exactMatch: true }),
      successResult({ tags: ["ambiguous"], exactMatch: false }),
      successResult({ tags: ["perfect"], exactMatch: false }), // pas "ambiguous", hors dénominateur
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.ambiguityRate).toBe(0.5);
  });

  it("aucun exemple \"ambiguous\" : null, jamais 0 fabriqué", () => {
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, [successResult({ tags: ["perfect"] })]);
    expect(metrics.ambiguityRate).toBeNull();
  });

  it("un exemple \"ambiguous\" sans champ comparable (fieldMatches vide) n'est jamais compté comme un échec d'ambiguïté", () => {
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, [successResult({ tags: ["ambiguous"], fieldMatches: {} })]);
    expect(metrics.ambiguityRate).toBeNull();
  });
});

describe("aggregateTcgMatrixMetrics — hybridSuccessRate", () => {
  it("identique à successCount/examplesTotal tant qu'aucun extracteur déterministe n'existe", () => {
    const results = [successResult(), successResult({ outcome: "provider_error", fieldMatches: {}, exactMatch: false })];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.hybridSuccessRate).toBe(0.5);
  });
});

describe("aggregateTcgMatrixMetrics — byTag", () => {
  it("segmente exactIdentificationAccuracy par tag, une entrée par tag réellement présent", () => {
    const results = [
      successResult({ tags: ["glare"], exactMatch: true }),
      successResult({ tags: ["glare"], exactMatch: false }),
      successResult({ tags: ["low_light"], exactMatch: true }),
    ];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.byTag).toHaveLength(2);
    const glare = metrics.byTag.find((t) => t.tag === "glare")!;
    const lowLight = metrics.byTag.find((t) => t.tag === "low_light")!;
    expect(glare).toEqual({ tag: "glare", examplesTotal: 2, successCount: 2, exactIdentificationAccuracy: 0.5 });
    expect(lowLight).toEqual({ tag: "low_light", examplesTotal: 1, successCount: 1, exactIdentificationAccuracy: 1 });
  });

  it("un exemple portant plusieurs tags contribue à chacun d'eux", () => {
    const results = [successResult({ tags: ["glare", "low_light"], exactMatch: true })];
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, results);
    expect(metrics.byTag.map((t) => t.tag).sort()).toEqual(["glare", "low_light"]);
  });

  it("aucun exemple : byTag vide", () => {
    const metrics = aggregateTcgMatrixMetrics(MATRIX_ENTRY, []);
    expect(metrics.byTag).toEqual([]);
  });
});
