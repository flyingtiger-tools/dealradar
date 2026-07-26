import { describe, expect, it } from "vitest";
import { aggregate, combineAggregates, MixedProvenanceError } from "../aggregate";
import type { BenchmarkListingResult } from "../../types";

function result(overrides: Partial<BenchmarkListingResult> = {}): BenchmarkListingResult {
  return {
    itemId: "x",
    usable: true,
    extractionSource: "deterministic",
    cacheHit: false,
    warnings: [],
    estimatedCostUsd: 0,
    decision: "INSUFFICIENT_DATA",
    sufficiencyCorrect: null,
    timings: { mappingMs: 1, extractionMs: 1, cacheMs: 0, providerMs: 0, intelligenceMs: 1, totalMs: 3 },
    ...overrides,
  };
}

describe("aggregate", () => {
  it("calcule les taux de base sur un lot mixte déterministe/IA", () => {
    const results = [
      result({ itemId: "a", extractionSource: "deterministic" }),
      result({ itemId: "b", extractionSource: "ai", estimatedCostUsd: 0.001 }),
      result({ itemId: "c", extractionSource: "cache", cacheHit: true }),
      result({ itemId: "d", usable: false, decision: null }),
    ];
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego.json", results });

    expect(metrics.totalListings).toBe(4);
    expect(metrics.usableListings).toBe(3);
    expect(metrics.rates.deterministicOnly).toBeCloseTo(1 / 3, 5);
    expect(metrics.rates.aiCalled).toBeCloseTo(2 / 3, 5);
    expect(metrics.rates.cacheHit).toBeCloseTo(1 / 2, 5);
  });

  it("retourne precisionAnnotee=null quand aucune entrée n'est annotée", () => {
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "x", results: [result()] });
    expect(metrics.precisionAnnotee).toBeNull();
  });

  it("calcule precisionAnnotee uniquement sur les entrées annotées", () => {
    const results = [
      result({ sufficiencyCorrect: true }),
      result({ sufficiencyCorrect: true }),
      result({ sufficiencyCorrect: false }),
      result({ sufficiencyCorrect: null }),
    ];
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "x", results });
    expect(metrics.precisionAnnotee).toBeCloseTo(2 / 3, 5);
  });

  it("liste les annonces à problème (inutilisable, précision incorrecte, contradiction)", () => {
    const results = [
      result({ itemId: "ok" }),
      result({ itemId: "bad-precision", sufficiencyCorrect: false }),
      result({ itemId: "unusable", usable: false, decision: null }),
      result({ itemId: "contradiction", warnings: [{ code: "MAJOR_CONTRADICTION", message: "x" }] }),
    ];
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "x", results });
    const ids = metrics.problemListings.map((p) => p.itemId);
    expect(ids).toEqual(["bad-precision", "unusable", "contradiction"]);
  });

  it("ne compte jamais INSUFFICIENT_DATA seul comme un problème", () => {
    const metrics = aggregate({
      categorySlug: "lego",
      provenance: "synthetic",
      datasetLabel: "x",
      results: [result({ decision: "INSUFFICIENT_DATA" })],
    });
    expect(metrics.problemListings).toHaveLength(0);
  });
});

describe("combineAggregates", () => {
  it("combine plusieurs datasets de même provenance", () => {
    const a = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego", results: [result()] });
    const b = aggregate({ categorySlug: "apple", provenance: "synthetic", datasetLabel: "apple", results: [result(), result()] });
    const combined = combineAggregates([a, b]);
    expect(combined.totalListings).toBe(3);
    expect(combined.provenance).toBe("synthetic");
  });

  it("refuse de combiner des provenances différentes", () => {
    const a = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego", results: [result()] });
    const b = aggregate({ categorySlug: "lego-real", provenance: "real", datasetLabel: "lego-real", results: [result()] });
    expect(() => combineAggregates([a, b])).toThrow(MixedProvenanceError);
  });
});
