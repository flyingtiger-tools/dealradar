import { describe, expect, it } from "vitest";
import { computeHistoryIntelligenceV2 } from "../history-signals-v2";
import type { HistoryPointV2 } from "../history-signals-v2";

const ASOF = "2026-09-21T00:00:00.000Z";

function point(overrides: Partial<HistoryPointV2>): HistoryPointV2 {
  return { observedAt: ASOF, priceCents: 10000, source: "bricklink", ...overrides };
}

function daysBefore(days: number): string {
  return new Date(Date.parse(ASOF) - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("computeHistoryIntelligenceV2", () => {
  it("aucun point -> résultat vide honnête, jamais une précision fabriquée", () => {
    const result = computeHistoryIntelligenceV2([], ASOF);
    expect(result.sampleSize).toBe(0);
    expect(result.medianCents).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("médiane/p25/p75 calculés sur l'échantillon complet (pas seulement après écart des aberrantes)", () => {
    const points = [1000, 2000, 3000, 4000, 5000].map((priceCents) => point({ priceCents }));
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.medianCents).toBe(3000);
    expect(result.sampleSize).toBe(5);
  });

  it("min/max EXCLUENT les valeurs aberrantes, jamais le min/max brut", () => {
    const points = [
      point({ priceCents: 9800 }),
      point({ priceCents: 10000 }),
      point({ priceCents: 10200 }),
      point({ priceCents: 10100 }),
      point({ priceCents: 500000 }), // aberrant
    ];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.maxCents).toBeLessThan(500000);
    expect(result.outlierCount).toBeGreaterThan(0);
  });

  it("tendances sur 7/30/90/180 jours, 'insufficient' quand trop peu de points dans la fenêtre", () => {
    const points = [point({ observedAt: daysBefore(1), priceCents: 10000 })];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.trends.map((t) => t.windowDays)).toEqual([7, 30, 90, 180]);
    expect(result.trends.every((t) => t.direction === "insufficient")).toBe(true);
  });

  it("tendance à la hausse détectée avec assez de points dans une fenêtre", () => {
    const points = [
      point({ observedAt: daysBefore(6), priceCents: 9000, source: "a" }),
      point({ observedAt: daysBefore(5), priceCents: 9100, source: "b" }),
      point({ observedAt: daysBefore(2), priceCents: 11000, source: "a" }),
      point({ observedAt: daysBefore(1), priceCents: 11200, source: "b" }),
    ];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    const trend7d = result.trends.find((t) => t.windowDays === 7)!;
    expect(trend7d.direction).toBe("up");
  });

  it("liquidityProxy est TOUJOURS étiqueté 'proxy', jamais présenté comme une liquidité confirmée", () => {
    const points = [
      point({ observedAt: daysBefore(1), isCurrentlyActiveListing: true }),
      point({ observedAt: daysBefore(2), isCurrentlyActiveListing: true, source: "b" }),
    ];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.liquidityProxy?.kind).toBe("proxy");
  });

  it("activeSupplyCount ne compte que les annonces marquées currentlySeen=true, jamais les disparues", () => {
    const points = [
      point({ observedAt: daysBefore(1), isCurrentlyActiveListing: true, source: "a" }),
      point({ observedAt: daysBefore(2), isCurrentlyActiveListing: false, source: "b" }),
      point({ observedAt: daysBefore(3), source: "c" }), // pas une annonce active du tout (ex. historique/vente)
    ];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.activeSupplyCount).toBe(1);
  });

  it("sourceDiversityOverTime compte TOUTES les sources de l'historique, pas seulement le dernier cycle", () => {
    const points = [point({ source: "a", observedAt: daysBefore(90) }), point({ source: "b", observedAt: daysBefore(1) }), point({ source: "c", observedAt: daysBefore(1) })];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.sourceDiversityOverTime).toBe(3);
  });

  it("historicalPercentilePosition situe le prix ACTUEL dans la distribution historique", () => {
    const points = [1000, 2000, 3000, 4000, 5000].map((priceCents) => point({ priceCents }));
    const result = computeHistoryIntelligenceV2(points, ASOF, { currentPriceCents: 5000 });
    expect(result.historicalPercentilePosition).toBe(100); // prix au plus haut de l'historique
  });

  it("priceNowVsHistory absent sans prix actuel fourni", () => {
    const points = [point({ priceCents: 10000 })];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.priceNowVsHistory).toBeNull();
  });

  it("priceNowVsHistory calcule le delta % par rapport à la médiane historique", () => {
    const points = [point({ priceCents: 10000 }), point({ priceCents: 10000 })];
    const result = computeHistoryIntelligenceV2(points, ASOF, { currentPriceCents: 12000 });
    expect(result.priceNowVsHistory?.deltaPercent).toBeCloseTo(20, 5);
  });

  it("confiance FAIBLE pour un historique peu profond, même si les stats se calculent techniquement", () => {
    const points = [point({ priceCents: 10000 })];
    const result = computeHistoryIntelligenceV2(points, ASOF);
    expect(result.confidence).toBeLessThan(50);
  });

  it("confiance plus élevée avec un historique profond, frais et diversifié en sources", () => {
    const shallowPoints = [point({ priceCents: 10000, source: "a" })];
    const deepPoints = Array.from({ length: 15 }, (_, i) => point({ priceCents: 10000 + i, source: `s${i % 5}`, observedAt: daysBefore(i) }));
    const shallow = computeHistoryIntelligenceV2(shallowPoints, ASOF);
    const deep = computeHistoryIntelligenceV2(deepPoints, ASOF);
    expect(deep.confidence).toBeGreaterThan(shallow.confidence);
  });
});
