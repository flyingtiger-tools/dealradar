import { describe, expect, it } from "vitest";
import {
  computeMedianRange,
  computeTrend,
  computeVolatility,
  summarizeObservations,
  computeActiveListingPersistenceHours,
  type HistoricalPricePoint,
} from "../history-signals";

function point(overrides: Partial<HistoricalPricePoint> = {}): HistoricalPricePoint {
  return { observedAt: "2026-09-01T00:00:00.000Z", priceCents: 10000, source: "ebay", ...overrides };
}

describe("computeMedianRange", () => {
  it("aucun point : null, jamais une médiane 0 fabriquée", () => {
    expect(computeMedianRange([])).toBeNull();
  });

  it("calcule médiane/p25/p75 sur un échantillon réel", () => {
    const points = [point({ priceCents: 8000 }), point({ priceCents: 9000 }), point({ priceCents: 10000 }), point({ priceCents: 11000 }), point({ priceCents: 12000 })];
    const signal = computeMedianRange(points);
    expect(signal?.medianCents).toBe(10000);
    expect(signal?.sampleSize).toBe(5);
  });
});

describe("computeTrend", () => {
  const asOf = "2026-09-21T00:00:00.000Z";

  it("échantillon insuffisant dans la fenêtre : 'insufficient', jamais une tendance devinée", () => {
    const points = [point({ observedAt: "2026-09-20T00:00:00.000Z" })];
    const trend = computeTrend(points, asOf, 7);
    expect(trend.direction).toBe("insufficient");
    expect(trend.changePercent).toBeNull();
  });

  it("prix en hausse significative entre la moitié ancienne et récente : 'up'", () => {
    const points = [
      point({ observedAt: "2026-09-15T00:00:00.000Z", priceCents: 10000 }),
      point({ observedAt: "2026-09-16T00:00:00.000Z", priceCents: 10000 }),
      point({ observedAt: "2026-09-19T00:00:00.000Z", priceCents: 12000 }),
      point({ observedAt: "2026-09-20T00:00:00.000Z", priceCents: 12000 }),
    ];
    const trend = computeTrend(points, asOf, 7);
    expect(trend.direction).toBe("up");
    expect(trend.changePercent).toBeCloseTo(20, 0);
  });

  it("prix en baisse significative : 'down'", () => {
    const points = [
      point({ observedAt: "2026-09-15T00:00:00.000Z", priceCents: 12000 }),
      point({ observedAt: "2026-09-16T00:00:00.000Z", priceCents: 12000 }),
      point({ observedAt: "2026-09-19T00:00:00.000Z", priceCents: 10000 }),
      point({ observedAt: "2026-09-20T00:00:00.000Z", priceCents: 10000 }),
    ];
    expect(computeTrend(points, asOf, 7).direction).toBe("down");
  });

  it("variation faible (< 3%) : 'flat', jamais un bruit présenté comme une tendance", () => {
    const points = [
      point({ observedAt: "2026-09-15T00:00:00.000Z", priceCents: 10000 }),
      point({ observedAt: "2026-09-16T00:00:00.000Z", priceCents: 10000 }),
      point({ observedAt: "2026-09-19T00:00:00.000Z", priceCents: 10100 }),
      point({ observedAt: "2026-09-20T00:00:00.000Z", priceCents: 10100 }),
    ];
    expect(computeTrend(points, asOf, 7).direction).toBe("flat");
  });

  it("un point hors fenêtre n'est jamais compté dans l'échantillon", () => {
    const points = [
      point({ observedAt: "2026-01-01T00:00:00.000Z", priceCents: 5000 }), // très ancien, hors fenêtre 7j
      point({ observedAt: "2026-09-19T00:00:00.000Z", priceCents: 10000 }),
      point({ observedAt: "2026-09-20T00:00:00.000Z", priceCents: 10000 }),
    ];
    const trend = computeTrend(points, asOf, 7);
    expect(trend.sampleSizeInWindow).toBe(2);
    expect(trend.direction).toBe("insufficient"); // 2 points ne suffisent pas (besoin de 2 par moitié)
  });
});

describe("computeVolatility", () => {
  it("moins de 2 points : null, jamais un écart-type sur un seul point", () => {
    expect(computeVolatility([point()])).toBeNull();
  });

  it("prix constants : volatilité nulle", () => {
    const points = [point({ priceCents: 10000 }), point({ priceCents: 10000 }), point({ priceCents: 10000 })];
    expect(computeVolatility(points)?.coefficientOfVariation).toBe(0);
  });

  it("prix dispersés : coefficient de variation positif", () => {
    const points = [point({ priceCents: 8000 }), point({ priceCents: 10000 }), point({ priceCents: 12000 })];
    const volatility = computeVolatility(points);
    expect(volatility?.coefficientOfVariation).toBeGreaterThan(0);
    expect(volatility?.sampleSize).toBe(3);
  });
});

describe("summarizeObservations", () => {
  it("aucun point : count 0, freshness null, jamais '0h' fabriqué", () => {
    const summary = summarizeObservations([], "2026-09-21T00:00:00.000Z");
    expect(summary).toEqual({ count: 0, sourceDiversity: 0, freshnessHours: null });
  });

  it("compte les sources distinctes, pas le nombre total d'observations", () => {
    const points = [point({ source: "ebay" }), point({ source: "ebay" }), point({ source: "google_shopping" })];
    const summary = summarizeObservations(points, "2026-09-21T00:00:00.000Z");
    expect(summary.count).toBe(3);
    expect(summary.sourceDiversity).toBe(2);
  });

  it("fraîcheur = heures depuis l'observation la PLUS RÉCENTE, jamais la plus ancienne", () => {
    const points = [point({ observedAt: "2026-09-19T00:00:00.000Z" }), point({ observedAt: "2026-09-20T00:00:00.000Z" })];
    const summary = summarizeObservations(points, "2026-09-21T00:00:00.000Z");
    expect(summary.freshnessHours).toBeCloseTo(24, 0);
  });
});

describe("computeActiveListingPersistenceHours", () => {
  it("moins de 2 instantanés : null", () => {
    expect(computeActiveListingPersistenceHours(["2026-09-20T00:00:00.000Z"])).toBeNull();
  });

  it("calcule l'écart entre le premier et le dernier instantané, jamais interprété comme 'vendue'", () => {
    const hours = computeActiveListingPersistenceHours(["2026-09-20T00:00:00.000Z", "2026-09-19T00:00:00.000Z", "2026-09-22T00:00:00.000Z"]);
    expect(hours).toBeCloseTo(72, 0);
  });
});
