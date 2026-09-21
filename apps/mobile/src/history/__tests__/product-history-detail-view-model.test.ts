import { toProductHistoryDetailViewModel } from "../product-history-detail-view-model";
import type { ProductHistoryResponse } from "../../api/product-history-client";

function baseResponse(overrides: Partial<ProductHistoryResponse["history"]> = {}): ProductHistoryResponse {
  return {
    history: {
      productKey: "lego:10300",
      asOf: "2026-09-21T00:00:00.000Z",
      recentSnapshotSummaries: [],
      history: {
        asOf: "2026-09-21T00:00:00.000Z",
        sampleSize: 0,
        medianCents: null,
        p25Cents: null,
        p75Cents: null,
        minCents: null,
        maxCents: null,
        outlierCount: 0,
        trends: [],
        activeSupplyCount: 0,
        sourceDiversityOverTime: 0,
        historicalPercentilePosition: null,
        confidence: 0,
        reasons: [],
      },
      activeSupplyCount: 0,
      sourceDiversity: 0,
      freshnessHours: null,
      ...overrides,
    },
  };
}

describe("toProductHistoryDetailViewModel", () => {
  it("historique vide : isEmpty true, jamais une exception", () => {
    const view = toProductHistoryDetailViewModel(baseResponse());
    expect(view.isEmpty).toBe(true);
    expect(view.sampleSize).toBe(0);
  });

  it("historique présent : médiane/bande/confiance repris tels quels", () => {
    const response = baseResponse({
      history: {
        asOf: "2026-09-21T00:00:00.000Z",
        sampleSize: 12,
        medianCents: 18000,
        p25Cents: 17500,
        p75Cents: 18500,
        minCents: 17000,
        maxCents: 19000,
        outlierCount: 1,
        trends: [{ windowDays: 30, direction: "up", changePercent: 5.2, sampleSizeInWindow: 6 }],
        activeSupplyCount: 3,
        sourceDiversityOverTime: 2,
        historicalPercentilePosition: 60,
        confidence: 55,
        reasons: [],
      },
      activeSupplyCount: 3,
      sourceDiversity: 2,
    });

    const view = toProductHistoryDetailViewModel(response);
    expect(view.isEmpty).toBe(false);
    expect(view.medianCents).toBe(18000);
    expect(view.lowCents).toBe(17500);
    expect(view.highCents).toBe(18500);
    expect(view.confidence).toBe(55);
    expect(view.activeSupplyCount).toBe(3);
    expect(view.sourceDiversity).toBe(2);
  });

  it("tendances traduites en libellés courts, jamais le code brut 'up'/'down' affiché", () => {
    const response = baseResponse({
      history: {
        asOf: "2026-09-21T00:00:00.000Z",
        sampleSize: 5,
        medianCents: 18000,
        p25Cents: 17000,
        p75Cents: 19000,
        minCents: 17000,
        maxCents: 19000,
        outlierCount: 0,
        trends: [
          { windowDays: 7, direction: "insufficient", changePercent: null, sampleSizeInWindow: 1 },
          { windowDays: 30, direction: "down", changePercent: -8, sampleSizeInWindow: 5 },
        ],
        activeSupplyCount: 0,
        sourceDiversityOverTime: 1,
        historicalPercentilePosition: null,
        confidence: 40,
        reasons: [],
      },
    });

    const view = toProductHistoryDetailViewModel(response);
    expect(view.trends).toEqual([
      { windowDays: 7, label: "Historique insuffisant", changePercent: null },
      { windowDays: 30, label: "En baisse", changePercent: -8 },
    ]);
  });

  it("résumés de cycle récents transmis tels quels, jamais recalculés", () => {
    const response = baseResponse({
      recentSnapshotSummaries: [
        { cycleAt: "2026-09-20T00:00:00.000Z", cycleKey: "k1", currency: "CHF", lowCents: 17000, fairCents: 18000, highCents: 19000, confidence: 60, observationCount: 3, sourceCount: 2 },
      ],
    });

    const view = toProductHistoryDetailViewModel(response);
    expect(view.snapshotPoints).toEqual([{ cycleAt: "2026-09-20T00:00:00.000Z", fairCents: 18000, lowCents: 17000, highCents: 19000, currency: "CHF" }]);
  });
});
