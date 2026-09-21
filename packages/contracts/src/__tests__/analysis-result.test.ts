import { describe, expect, it } from "vitest";
import { analysisResultSchema, marketEvidenceSchema } from "../analysis-result";

function baseResult() {
  return {
    product: { name: "LEGO 10300", category: "lego", modelOrReference: "10300" },
    conditionEstimated: "new",
    priceDetected: { amount: 150, currency: "CHF" },
    marketValueEstimate: { amount: 180, currency: "CHF", provenance: "market_guide" },
    resaleRangeConservative: { low: 170, high: 190, currency: "CHF" },
    grossMargin: 30,
    estimatedFees: 5,
    netMargin: 25,
    confidenceScore: 70,
    liquidityScore: 60,
    dealScore: 65,
    decision: "REVIEW",
    warnings: [],
    reasons: ["x"],
    dataAvailability: { soldTransactions: false, marketGuide: true },
  };
}

describe("analysisResultSchema — compatibilité marketEvidence (LOT Source Wave 2)", () => {
  it("un résultat SANS marketEvidence (forme pré-existante, TCG ou chemin générique historique) reste valide", () => {
    expect(() => analysisResultSchema.parse(baseResult())).not.toThrow();
  });

  it("un résultat AVEC marketEvidence valide est accepté", () => {
    const result = {
      ...baseResult(),
      marketEvidence: {
        strongestTier: "B",
        sourceCount: 2,
        observationCount: 5,
        liveObservationCount: 2,
        historicalObservationCount: 3,
        sourceNames: ["bricklink", "pricecharting"],
        retailOnlyWarning: false,
        activeListingsOnlyWarning: false,
        usedSpecialistHistory: true,
      },
    };
    expect(() => analysisResultSchema.parse(result)).not.toThrow();
  });

  it("marketEvidence accepte les diagnostics étendus (LOT Source Wave 3) : fx/direct-vs-agrégateur/mix/cost-class", () => {
    const result = {
      ...baseResult(),
      marketEvidence: {
        strongestTier: "B",
        sourceCount: 2,
        observationCount: 5,
        liveObservationCount: 2,
        historicalObservationCount: 3,
        sourceNames: ["bricklink", "keepa"],
        retailOnlyWarning: false,
        activeListingsOnlyWarning: false,
        usedSpecialistHistory: true,
        directSourceCount: 2,
        aggregatorSourceCount: 0,
        evidenceTypeMix: [{ evidenceType: "historicalPrices", count: 5 }],
        costClassesUsed: ["free", "paid"],
        fx: {
          observedCurrencies: ["CHF", "USD"],
          ratesUsed: [{ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-09-21", source: "frankfurter", fetchedAt: "2026-09-21T00:00:00.000Z" }],
          skippedForMissingRateCount: 0,
        },
      },
    };
    expect(() => analysisResultSchema.parse(result)).not.toThrow();
  });

  it("marketEvidence.strongestTier peut être null (aucune preuve exploitable)", () => {
    const parsed = marketEvidenceSchema.parse({
      strongestTier: null,
      sourceCount: 0,
      observationCount: 0,
      liveObservationCount: 0,
      historicalObservationCount: 0,
      sourceNames: [],
      retailOnlyWarning: false,
      activeListingsOnlyWarning: false,
      usedSpecialistHistory: false,
    });
    expect(parsed.strongestTier).toBeNull();
  });

  it("un palier hors A-E est rejeté", () => {
    expect(() =>
      marketEvidenceSchema.parse({
        strongestTier: "Z",
        sourceCount: 0,
        observationCount: 0,
        liveObservationCount: 0,
        historicalObservationCount: 0,
        sourceNames: [],
        retailOnlyWarning: false,
        activeListingsOnlyWarning: false,
        usedSpecialistHistory: false,
      }),
    ).toThrow();
  });
});
