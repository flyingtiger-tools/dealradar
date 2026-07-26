import { describe, expect, it } from "vitest";
import { renderReport } from "../render-html";
import { aggregate } from "../../metrics/aggregate";
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
    sufficiencyCorrect: true,
    timings: { mappingMs: 1, extractionMs: 1, cacheMs: 0, providerMs: 0, intelligenceMs: 1, totalMs: 3 },
    ...overrides,
  };
}

describe("renderReport", () => {
  it("produit un document HTML autonome et bien formé", () => {
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego.json", results: [result()] });
    const html = renderReport({ generatedAt: "2026-07-26T00:00:00.000Z", providerLabel: "simulated", mode: "offline", datasets: [metrics] });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("lego.json");
    expect(html).toContain("<svg");
  });

  it("libelle la précision comme « cohérence sur dataset synthétique » pour un dataset synthétique", () => {
    const metrics = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego.json", results: [result()] });
    const html = renderReport({ generatedAt: "x", providerLabel: "simulated", mode: "offline", datasets: [metrics] });
    expect(html).toContain("Cohérence sur dataset synthétique");
    expect(html).not.toContain("Performance sur dataset réel");
  });

  it("libelle la précision comme « performance sur dataset réel » pour un dataset réel", () => {
    const metrics = aggregate({ categorySlug: "lego", provenance: "real", datasetLabel: "lego-export.json", results: [result()] });
    const html = renderReport({ generatedAt: "x", providerLabel: "openai", mode: "offline", datasets: [metrics] });
    expect(html).toContain("Performance sur dataset réel");
  });

  it("avertit si des datasets de provenances différentes sont présents dans le même rapport", () => {
    const synthetic = aggregate({ categorySlug: "lego", provenance: "synthetic", datasetLabel: "lego.json", results: [result()] });
    const real = aggregate({ categorySlug: "apple", provenance: "real", datasetLabel: "apple-export.json", results: [result()] });
    const html = renderReport({ generatedAt: "x", providerLabel: "openai", mode: "offline", datasets: [synthetic, real] });
    expect(html).toContain("provenances différentes");
  });

  it("échappe le HTML des identifiants d'annonce dans le tableau des problèmes", () => {
    const metrics = aggregate({
      categorySlug: "lego",
      provenance: "synthetic",
      datasetLabel: "lego.json",
      results: [result({ itemId: "<img src=x onerror=alert(1)>", sufficiencyCorrect: false })],
    });
    const html = renderReport({ generatedAt: "x", providerLabel: "simulated", mode: "offline", datasets: [metrics] });
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});
