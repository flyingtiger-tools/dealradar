import { describe, expect, it } from "vitest";
import { computeHistoryIntelligenceV2, type HistoryPointV2 } from "@dealradar/core";
import { toFusionHistoryContext } from "../to-fusion-history-context";

const ASOF = "2026-09-21T00:00:00.000Z";

describe("toFusionHistoryContext", () => {
  it("historique vide (sampleSize 0) : null, jamais un contexte fabriqué", () => {
    const history = computeHistoryIntelligenceV2([], ASOF);
    expect(toFusionHistoryContext(history, null)).toBeNull();
  });

  it("historique présent : projette médiane/confiance/taille sans les recalculer", () => {
    const points: HistoryPointV2[] = [
      { observedAt: "2026-09-01T00:00:00.000Z", priceCents: 18000, source: "bricklink" },
      { observedAt: "2026-09-10T00:00:00.000Z", priceCents: 18500, source: "ebay" },
    ];
    const history = computeHistoryIntelligenceV2(points, ASOF);
    const context = toFusionHistoryContext(history, 26);
    expect(context).not.toBeNull();
    expect(context?.historicalMedianCents).toBe(history.medianCents);
    expect(context?.confidence).toBe(history.confidence);
    expect(context?.sampleSize).toBe(2);
    expect(context?.freshnessHours).toBe(26);
  });

  it("aucune fenêtre suffisante : trendDirection 'insufficient', jamais une tendance devinée", () => {
    const points: HistoryPointV2[] = [{ observedAt: "2026-09-20T00:00:00.000Z", priceCents: 18000, source: "bricklink" }];
    const history = computeHistoryIntelligenceV2(points, ASOF);
    const context = toFusionHistoryContext(history, 24);
    expect(context?.trendDirection).toBe("insufficient");
  });

  it("retient la fenêtre la plus courte avec un signal réel, pas une fenêtre fixe", () => {
    const points: HistoryPointV2[] = [];
    for (let i = 0; i < 10; i++) {
      points.push({ observedAt: new Date(Date.parse(ASOF) - i * 24 * 60 * 60 * 1000).toISOString(), priceCents: 18000 + i * 200, source: "bricklink" });
    }
    const history = computeHistoryIntelligenceV2(points, ASOF);
    const context = toFusionHistoryContext(history, 12);
    const sevenDayTrend = history.trends.find((t) => t.windowDays === 7);
    expect(context?.trendDirection).toBe(sevenDayTrend?.direction);
  });
});
