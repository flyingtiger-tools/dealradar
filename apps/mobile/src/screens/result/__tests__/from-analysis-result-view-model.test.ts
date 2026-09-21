import type { AnalysisResult } from "@dealradar/contracts";
import { mapAnalysisResultToViewModel } from "../from-analysis-result-view-model";

/**
 * Tests du mapper générique AnalysisResult -> ResultViewModel (LOT
 * "Universal Object Valuation Foundation") — même discipline que
 * `result-view-model.test.ts` (TCG) : le signal de vérité est
 * `product.name`, jamais `status` seul ; un objet identifié sans preuve de
 * marché suffisante reste `identityStatus: "identified"`.
 */

function baseResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    product: { name: null, category: null, modelOrReference: null },
    conditionEstimated: null,
    priceDetected: null,
    marketValueEstimate: null,
    resaleRangeConservative: null,
    grossMargin: null,
    estimatedFees: null,
    netMargin: null,
    confidenceScore: 0,
    liquidityScore: 0,
    dealScore: null,
    decision: "INSUFFICIENT_DATA",
    warnings: [],
    reasons: [],
    dataAvailability: { soldTransactions: false, marketGuide: false },
    ...overrides,
  };
}

describe("mapAnalysisResultToViewModel", () => {
  it("aucun résultat : insufficient_data, jamais un crash", () => {
    const view = mapAnalysisResultToViewModel(null, "insufficient_data", "watches");
    expect(view.identityStatus).toBe("insufficient_data");
    expect(view.category).toBe("watches");
    expect(view.product.name).toBeNull();
  });

  it("status failed sans produit identifié : identityStatus 'failed'", () => {
    const view = mapAnalysisResultToViewModel(baseResult({ warnings: ["CATEGORY_REQUIRED"] }), "failed", "watches");
    expect(view.identityStatus).toBe("failed");
    expect(view.warnings).toEqual(["CATEGORY_REQUIRED"]);
  });

  it("produit identifié avec prix : identityStatus 'identified', hasPricing true, fourchette basse/haute reprise telle quelle", () => {
    const result = baseResult({
      product: { name: "Rolex Submariner", category: "watches", modelOrReference: "116610LN" },
      conditionEstimated: "very_good",
      marketValueEstimate: { amount: 8500, currency: "CHF", provenance: "sold_transaction" },
      resaleRangeConservative: { low: 8000, high: 9200, currency: "CHF" },
      confidenceScore: 72,
      dealScore: 55,
      decision: "REVIEW",
      reasons: ["Marge nette prometteuse (score 55/100)."],
    });
    const view = mapAnalysisResultToViewModel(result, "completed", "watches");

    expect(view.identityStatus).toBe("identified");
    expect(view.category).toBe("watches");
    expect(view.product.name).toBe("Rolex Submariner");
    expect(view.product.setName).toBe("Montres"); // libellé humain de la catégorie
    expect(view.product.collectorNumber).toBe("116610LN");
    expect(view.hasPricing).toBe(true);
    expect(view.prices).toEqual([
      { source: "sold_transaction", amountCents: 800000, currency: "CHF", condition: "very_good", updatedAt: null, convertedAmountCents: null, convertedCurrency: null },
      { source: "sold_transaction", amountCents: 920000, currency: "CHF", condition: "very_good", updatedAt: null, convertedAmountCents: null, convertedCurrency: null },
    ]);
    expect(view.decision).toBe("REVIEW");
    expect(view.dealScore).toBe(55);
    expect(view.confidencePercent).toBe(72);
    expect(view.reasons).toEqual(["Marge nette prometteuse (score 55/100)."]);
  });

  it("produit identifié mais sans preuve de marché suffisante : reste 'identified', jamais 'insufficient_data' au niveau de l'identité", () => {
    const result = baseResult({
      product: { name: "Console rétro inconnue", category: "general", modelOrReference: null },
      conditionEstimated: "good",
      decision: "INSUFFICIENT_DATA",
      confidenceScore: 30,
    });
    const view = mapAnalysisResultToViewModel(result, "insufficient_data", "general");
    expect(view.identityStatus).toBe("identified");
    expect(view.decision).toBe("INSUFFICIENT_DATA");
    expect(view.hasPricing).toBe(false);
    expect(view.prices).toEqual([]);
  });

  it("une seule valeur de fourchette (low === high) ne produit qu'une seule ligne de prix, jamais un doublon", () => {
    const result = baseResult({
      product: { name: "PS5 Digital Edition", category: "gaming", modelOrReference: null },
      marketValueEstimate: { amount: 300, currency: "CHF", provenance: "active_listing" },
      resaleRangeConservative: { low: 300, high: 300, currency: "CHF" },
    });
    const view = mapAnalysisResultToViewModel(result, "completed", "gaming");
    expect(view.prices).toHaveLength(1);
    expect(view.prices[0]!.source).toBe("active_listing");
  });

  it("confidenceScore est repris tel quel (déjà 0-100), jamais reconverti", () => {
    const result = baseResult({ product: { name: "x", category: null, modelOrReference: null }, confidenceScore: 83.6 });
    const view = mapAnalysisResultToViewModel(result, "completed", "general");
    expect(view.confidencePercent).toBe(84); // arrondi, pas de double conversion
  });

  it("une catégorie sans libellé connu retombe honnêtement sur le slug brut, jamais masquée", () => {
    const result = baseResult({ product: { name: "x", category: "unknown_future_category", modelOrReference: null } });
    const view = mapAnalysisResultToViewModel(result, "completed", "general");
    expect(view.product.setName).toBe("unknown_future_category");
  });

  it("isDemo est toujours false — jamais un résultat réel confondu avec une fixture", () => {
    const view = mapAnalysisResultToViewModel(baseResult({ product: { name: "x", category: null, modelOrReference: null } }), "completed", "general");
    expect(view.isDemo).toBe(false);
  });

  describe("marketInsight (LOT Data Quality Calibration, section 10)", () => {
    it("aucun marketEvidence : marketInsight null, jamais un résumé inventé", () => {
      const result = baseResult({ product: { name: "x", category: null, modelOrReference: null } });
      const view = mapAnalysisResultToViewModel(result, "completed", "general");
      expect(view.marketInsight).toBeNull();
    });

    it("marketEvidence présent : source count / palier / avertissements repris tels quels", () => {
      const result = baseResult({
        product: { name: "Console rétro", category: "gaming", modelOrReference: null },
        resaleRangeConservative: { low: 100, high: 150, currency: "CHF" },
        confidenceScore: 63.4,
        marketEvidence: {
          strongestTier: "D",
          sourceCount: 3,
          observationCount: 8,
          liveObservationCount: 8,
          historicalObservationCount: 0,
          sourceNames: ["ebay", "google_shopping"],
          retailOnlyWarning: false,
          activeListingsOnlyWarning: true,
          usedSpecialistHistory: false,
        },
      });
      const view = mapAnalysisResultToViewModel(result, "completed", "gaming");
      expect(view.marketInsight).toEqual({
        fairValueLowCents: 10000,
        fairValueHighCents: 15000,
        currency: "CHF",
        confidencePercent: 63,
        sourceCount: 3,
        strongestEvidenceTier: "D",
        trendDescriptor: null,
        trendConfidence: null,
        retailOnlyWarning: false,
        activeListingOnlyWarning: true,
        qualityReasons: [],
      });
    });

    it("qualityFlags connus : traduits en libellés courts français, jamais les codes bruts", () => {
      const result = baseResult({
        product: { name: "x", category: null, modelOrReference: null },
        marketEvidence: {
          strongestTier: "E",
          sourceCount: 1,
          observationCount: 2,
          liveObservationCount: 2,
          historicalObservationCount: 0,
          sourceNames: ["google_shopping"],
          retailOnlyWarning: true,
          activeListingsOnlyWarning: false,
          usedSpecialistHistory: false,
          qualityFlags: ["retail_only", "low_source_diversity"],
        },
      });
      const view = mapAnalysisResultToViewModel(result, "completed", "general");
      expect(view.marketInsight?.qualityReasons).toEqual(["Uniquement des prix neufs / retail", "Peu de sources différentes"]);
      expect(view.marketInsight?.qualityReasons.join(" ")).not.toMatch(/retail_only|low_source_diversity/);
    });

    it("flag inconnu (futur) : retombe honnêtement sur son code brut, jamais masqué", () => {
      const result = baseResult({
        product: { name: "x", category: null, modelOrReference: null },
        marketEvidence: {
          strongestTier: "A",
          sourceCount: 2,
          observationCount: 5,
          liveObservationCount: 5,
          historicalObservationCount: 0,
          sourceNames: ["ebay"],
          retailOnlyWarning: false,
          activeListingsOnlyWarning: false,
          usedSpecialistHistory: false,
          qualityFlags: ["some_future_flag"],
        },
      });
      const view = mapAnalysisResultToViewModel(result, "completed", "general");
      expect(view.marketInsight?.qualityReasons).toEqual(["some_future_flag"]);
    });

    it("trend/historique transmis quand fournis par le contrat, jamais reconstruits ici", () => {
      const result = baseResult({
        product: { name: "x", category: null, modelOrReference: null },
        marketEvidence: {
          strongestTier: "B",
          sourceCount: 2,
          observationCount: 4,
          liveObservationCount: 4,
          historicalObservationCount: 0,
          sourceNames: ["bricklink"],
          retailOnlyWarning: false,
          activeListingsOnlyWarning: false,
          usedSpecialistHistory: true,
          trendDescriptor: "up",
          trendConfidence: 72,
          historicalReferenceMedianCents: 18000,
        },
      });
      const view = mapAnalysisResultToViewModel(result, "completed", "general");
      expect(view.marketInsight?.trendDescriptor).toBe("up");
      expect(view.marketInsight?.trendConfidence).toBe(72);
    });
  });
});
