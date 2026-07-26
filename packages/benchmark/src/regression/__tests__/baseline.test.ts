import { describe, expect, it, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { saveBaseline, loadBaseline, compareToBaseline, extractQualityMetrics } from "../baseline";
import { aggregate } from "../../metrics/aggregate";
import type { BenchmarkListingResult } from "../../types";

const TMP_PATH = path.resolve(__dirname, "tmp-baseline.json");

function result(overrides: Partial<BenchmarkListingResult> = {}): BenchmarkListingResult {
  return {
    itemId: "x",
    usable: true,
    extractionSource: "deterministic",
    cacheHit: false,
    warnings: [],
    estimatedCostUsd: 0,
    decision: "INSUFFICIENT_DATA",
    sufficiencyCorrect: true,
    timings: { mappingMs: 1, extractionMs: 1, cacheMs: 0, providerMs: 0, intelligenceMs: 1, totalMs: 3 },
    ...overrides,
  };
}

describe("baseline regression", () => {
  afterEach(() => {
    if (existsSync(TMP_PATH)) rmSync(TMP_PATH);
  });

  it("retourne passed=true en l'absence de baseline (premier run)", () => {
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego", results: [result()] });
    const regression = compareToBaseline(metrics, null);
    expect(regression.passed).toBe(true);
  });

  it("sauvegarde puis recharge une baseline identique", () => {
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego", results: [result()] });
    saveBaseline(TMP_PATH, metrics);
    const loaded = loadBaseline(TMP_PATH);
    expect(loaded?.quality).toEqual(extractQualityMetrics(metrics));
  });

  it("détecte une régression de précision annotée au-delà de la tolérance", () => {
    const good = aggregate({
      categorySlug: "lego",
      provenance: "synthetic",
      datasetLabel: "lego",
      results: [result({ sufficiencyCorrect: true }), result({ sufficiencyCorrect: true })],
    });
    saveBaseline(TMP_PATH, good);

    const worse = aggregate({
      categorySlug: "lego",
      provenance: "synthetic",
      datasetLabel: "lego",
      results: [result({ sufficiencyCorrect: false }), result({ sufficiencyCorrect: false })],
    });
    const regression = compareToBaseline(worse, loadBaseline(TMP_PATH));
    expect(regression.passed).toBe(false);
  });

  it("détecte une hausse du taux de contradiction majeure", () => {
    const good = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego", results: [result()] });
    saveBaseline(TMP_PATH, good);

    const worse = aggregate({
      categorySlug: "lego",
      provenance: "synthetic",
      datasetLabel: "lego",
      results: Array.from({ length: 10 }, () => result({ warnings: [{ code: "MAJOR_CONTRADICTION", message: "x" }] })),
    });
    const regression = compareToBaseline(worse, loadBaseline(TMP_PATH));
    expect(regression.passed).toBe(false);
  });

  it("ne compare jamais la latence ou le coût — ces métriques n'apparaissent pas dans QualityMetrics", () => {
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego", results: [result()] });
    const quality = extractQualityMetrics(metrics);
    expect(Object.keys(quality).sort()).toEqual(
      ["precisionAnnotee", "tauxContradictionMajeure", "tauxExtractionInvalide", "tauxInsufficientData"].sort(),
    );
  });

  it("passe toujours si un écart de qualité reste dans la tolérance", () => {
    const good = aggregate({
      categorySlug: "lego",
      provenance: "synthetic",
      datasetLabel: "lego",
      results: Array.from({ length: 100 }, () => result({ sufficiencyCorrect: true })),
    });
    saveBaseline(TMP_PATH, good);

    const slightlyWorse = aggregate({
      categorySlug: "lego",
      provenance: "synthetic",
      datasetLabel: "lego",
      results: [
        ...Array.from({ length: 98 }, () => result({ sufficiencyCorrect: true })),
        ...Array.from({ length: 2 }, () => result({ sufficiencyCorrect: false })),
      ],
    });
    const regression = compareToBaseline(slightlyWorse, loadBaseline(TMP_PATH));
    expect(regression.passed).toBe(true);
  });
});
