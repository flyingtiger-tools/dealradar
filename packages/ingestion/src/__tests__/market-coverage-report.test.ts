import { describe, expect, it } from "vitest";
import { buildMarketCoverageReport } from "../market-coverage-report";

const ASOF = "2026-09-21T00:00:00.000Z";

describe("buildMarketCoverageReport", () => {
  it("compte succès/échecs par statut de diagnostic", () => {
    const report = buildMarketCoverageReport({
      categorySlug: "lego",
      asOf: ASOF,
      sourceDiagnostics: [
        { source: "bricklink", status: "success", observationCount: 5, latencyMs: 100 },
        { source: "pricecharting", status: "error", observationCount: 0, latencyMs: 50, errorMessage: "x" },
        { source: "keepa", status: "timeout", observationCount: 0, latencyMs: 10000 },
      ],
      observationsReturned: 5,
      observationsAfterCanonicalDedupe: 5,
      observationsUsableAfterFx: 5,
      observationsPersisted: 5,
    });

    expect(report.sourcesQueried).toBe(3);
    expect(report.sourcesSucceeded).toBe(1);
    expect(report.sourcesFailed).toBe(2);
  });

  it("médiane de latence calculée sur les sources interrogées", () => {
    const report = buildMarketCoverageReport({
      categorySlug: "lego",
      asOf: ASOF,
      sourceDiagnostics: [
        { source: "a", status: "success", observationCount: 1, latencyMs: 100 },
        { source: "b", status: "success", observationCount: 1, latencyMs: 200 },
        { source: "c", status: "success", observationCount: 1, latencyMs: 300 },
      ],
      observationsReturned: 3,
      observationsAfterCanonicalDedupe: 3,
      observationsUsableAfterFx: 3,
      observationsPersisted: null,
    });
    expect(report.medianLatencyMs).toBe(200);
  });

  it("aucune source interrogée -> medianLatencyMs null, jamais 0 fabriqué", () => {
    const report = buildMarketCoverageReport({
      categorySlug: "lego",
      asOf: ASOF,
      sourceDiagnostics: [],
      observationsReturned: 0,
      observationsAfterCanonicalDedupe: 0,
      observationsUsableAfterFx: 0,
      observationsPersisted: null,
    });
    expect(report.medianLatencyMs).toBeNull();
    expect(report.sourcesQueried).toBe(0);
  });

  it("chaque entrée de source porte sa classe de coût déclarative", () => {
    const report = buildMarketCoverageReport({
      categorySlug: "gaming",
      asOf: ASOF,
      sourceDiagnostics: [{ source: "pricecharting", status: "success", observationCount: 1, latencyMs: 100 }],
      observationsReturned: 1,
      observationsAfterCanonicalDedupe: 1,
      observationsUsableAfterFx: 1,
      observationsPersisted: null,
    });
    expect(report.perSource[0]!.costClass).toBe("cheap");
  });

  it("distingue observationsReturned (avant dédoublonnage canonique) de observationsAfterCanonicalDedupe", () => {
    const report = buildMarketCoverageReport({
      categorySlug: "apple",
      asOf: ASOF,
      sourceDiagnostics: [],
      observationsReturned: 10,
      observationsAfterCanonicalDedupe: 8,
      observationsUsableAfterFx: 6,
      observationsPersisted: null,
    });
    expect(report.observationsReturned).toBe(10);
    expect(report.observationsAfterCanonicalDedupe).toBe(8);
    expect(report.observationsUsableAfterFx).toBe(6);
  });
});
