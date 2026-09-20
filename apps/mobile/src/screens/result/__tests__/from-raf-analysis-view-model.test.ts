import type { RafAnalysis } from "../../../identification/types";
import { mapRafAnalysisToViewModel } from "../from-raf-analysis-view-model";

/**
 * Tests du mapper RafAnalysis -> ResultViewModel (LOT "rendre le scan
 * universel accessible dans l'app") — même discipline que les autres
 * mappers (`result-view-model.test.ts`, `from-analysis-result-view-model.test.ts`) :
 * signal de vérité = `product.name`, jamais `status` seul.
 */

function baseAnalysis(overrides: Partial<RafAnalysis> = {}): RafAnalysis {
  return {
    category: "watches",
    status: "insufficient_data",
    product: { name: null, setName: null, collectorNumber: null, language: null },
    confidence: null,
    decision: null,
    dealScore: null,
    valuation: { low: null, high: null, currency: null },
    evidence: [],
    missingInformation: [],
    risks: [],
    analysisId: null,
    ...overrides,
  };
}

describe("mapRafAnalysisToViewModel", () => {
  it("identifié avec prix : identityStatus 'identified', catégorie reprise, fourchette convertie en centimes", () => {
    const analysis = baseAnalysis({
      status: "identified",
      product: { name: "Rolex Submariner", setName: "Montres", collectorNumber: "116610LN", language: null },
      confidence: 0.82,
      decision: "REVIEW",
      dealScore: 55,
      valuation: { low: 8200, high: 8800, currency: "CHF" },
      evidence: ["sold_transaction"],
    });

    const view = mapRafAnalysisToViewModel(analysis, "watches");

    expect(view.identityStatus).toBe("identified");
    expect(view.category).toBe("watches");
    expect(view.product.name).toBe("Rolex Submariner");
    expect(view.product.collectorNumber).toBe("116610LN");
    expect(view.confidencePercent).toBe(82);
    expect(view.hasPricing).toBe(true);
    expect(view.prices).toEqual([
      { source: "sold_transaction", amountCents: 820000, currency: "CHF", condition: null, updatedAt: null, convertedAmountCents: null, convertedCurrency: null },
      { source: "sold_transaction", amountCents: 880000, currency: "CHF", condition: null, updatedAt: null, convertedAmountCents: null, convertedCurrency: null },
    ]);
    expect(view.decision).toBe("REVIEW");
    expect(view.dealScore).toBe(55);
  });

  it("insufficient_data (aucun produit identifié) : jamais 'identified', jamais un prix inventé", () => {
    const analysis = baseAnalysis({ status: "insufficient_data", risks: ["Preuve de marché insuffisante."] });

    const view = mapRafAnalysisToViewModel(analysis, "general");

    expect(view.identityStatus).toBe("insufficient_data");
    expect(view.category).toBe("watches"); // catégorie de l'analyse elle-même, prioritaire sur le fallback
    expect(view.hasPricing).toBe(false);
    expect(view.prices).toEqual([]);
    expect(view.reasonMessage).toBe("Preuve de marché insuffisante.");
  });

  it("failed : identityStatus 'failed', message par défaut si aucun risque explicite", () => {
    const analysis = baseAnalysis({ status: "failed", risks: [] });

    const view = mapRafAnalysisToViewModel(analysis, "watches");

    expect(view.identityStatus).toBe("failed");
    expect(view.reasonMessage).toBe("Identification impossible avec les informations disponibles.");
  });

  it("category null sur l'analyse (aucun adaptateur n'a revendiqué la capture) : retombe sur la catégorie de repli fournie par l'appelant", () => {
    const analysis = baseAnalysis({ category: null, status: "insufficient_data" });

    const view = mapRafAnalysisToViewModel(analysis, "general");

    expect(view.category).toBe("general");
  });

  it("identifié mais sans preuve de marché suffisante : reste 'identified', hasPricing false, jamais un échec total", () => {
    const analysis = baseAnalysis({
      status: "identified",
      product: { name: "Console rétro inconnue", setName: "general", collectorNumber: null, language: null },
      confidence: 0.3,
    });

    const view = mapRafAnalysisToViewModel(analysis, "general");

    expect(view.identityStatus).toBe("identified");
    expect(view.hasPricing).toBe(false);
    expect(view.prices).toEqual([]);
  });

  it("une seule valeur de fourchette (low === high) ne produit qu'une seule ligne de prix", () => {
    const analysis = baseAnalysis({
      status: "identified",
      product: { name: "PS5 Digital Edition", setName: "gaming", collectorNumber: null, language: null },
      valuation: { low: 300, high: 300, currency: "CHF" },
      evidence: ["active_listing"],
    });

    const view = mapRafAnalysisToViewModel(analysis, "gaming");

    expect(view.prices).toHaveLength(1);
    expect(view.prices[0]!.source).toBe("active_listing");
  });

  it("decision inconnue/invalide (jamais produite en pratique, mais jamais propagée telle quelle) : null plutôt qu'une valeur non reconnue", () => {
    const analysis = baseAnalysis({
      status: "identified",
      product: { name: "x", setName: null, collectorNumber: null, language: null },
      decision: "SOMETHING_UNEXPECTED",
    });

    const view = mapRafAnalysisToViewModel(analysis, "general");

    expect(view.decision).toBeNull();
  });

  it("status 'needs_confirmation' (jamais produit par un adaptateur générique, traitement défensif uniquement) : insufficient_data, jamais un crash", () => {
    const analysis = baseAnalysis({ status: "needs_confirmation", missingInformation: ["cardNumber"] });

    const view = mapRafAnalysisToViewModel(analysis, "watches");

    expect(view.identityStatus).toBe("insufficient_data");
  });

  it("aucune fourchette disponible (currency null) : hasPricing false, jamais une ligne de prix incomplète", () => {
    const analysis = baseAnalysis({
      status: "identified",
      product: { name: "x", setName: null, collectorNumber: null, language: null },
      valuation: { low: null, high: null, currency: null },
    });

    const view = mapRafAnalysisToViewModel(analysis, "general");

    expect(view.hasPricing).toBe(false);
    expect(view.prices).toEqual([]);
  });

  it("isDemo est toujours false — jamais un résultat réel confondu avec une fixture", () => {
    const analysis = baseAnalysis({ status: "identified", product: { name: "x", setName: null, collectorNumber: null, language: null } });
    expect(mapRafAnalysisToViewModel(analysis, "general").isDemo).toBe(false);
  });
});
