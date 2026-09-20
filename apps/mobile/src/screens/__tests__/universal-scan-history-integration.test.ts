jest.mock("expo-crypto", () => ({ randomUUID: () => "mock-uuid" }));

import type { RafAnalysis } from "../../identification/types";
import { mapRafAnalysisToViewModel } from "../result/from-raf-analysis-view-model";
import { buildHistoryCandidateFromResultViewModel } from "../../history/from-result-view-model";

/**
 * Test d'intégration bout-en-bout du NOUVEAU chemin (LOT "rendre le scan
 * universel accessible dans l'app") : RafAnalysis (produit par
 * `genericObjectAdapters`) -> ResultViewModel -> candidat d'historique.
 * Distinct du test équivalent du lot précédent
 * (`history/__tests__/from-result-view-model.test.ts`), qui part d'un
 * `ResultViewModel` construit à la main — celui-ci part du VRAI contrat
 * `RafAnalysis` que `UniversalScanScreen` produit réellement, pour prouver
 * que la chaîne complète (pas seulement chaque maillon isolément) enregistre
 * bien la vraie catégorie, jamais "pokemon_tcg" par défaut.
 */

function identifiedWatchAnalysis(): RafAnalysis {
  return {
    category: "watches",
    status: "identified",
    product: { name: "Omega Speedmaster", setName: "Montres", collectorNumber: "311.30.42.30.01.005", language: null },
    confidence: 0.7,
    decision: "REVIEW",
    dealScore: 60,
    valuation: { low: 4200, high: 4800, currency: "CHF" },
    evidence: ["sold_transaction"],
    missingInformation: [],
    risks: [],
    analysisId: "analysis-42",
  };
}

describe("Chaîne RafAnalysis -> ResultViewModel -> HistoryEntry (catégorie non-TCG)", () => {
  it("un objet non-TCG identifié est historisé sous sa vraie catégorie, jamais pokemon_tcg", () => {
    const view = mapRafAnalysisToViewModel(identifiedWatchAnalysis(), "watches");
    const candidate = buildHistoryCandidateFromResultViewModel(view, "2026-01-01T00:00:00.000Z");

    expect(candidate).not.toBeNull();
    expect(candidate!.category).toBe("watches");
    expect(candidate!.productKey.startsWith("watches|")).toBe(true);
    expect(candidate!.marketValue).toEqual({ low: 4200, high: 4800, currency: "CHF" });
  });

  it("un objet non identifié n'est jamais historisé (même règle que TCG)", () => {
    const analysis: RafAnalysis = {
      category: "general",
      status: "insufficient_data",
      product: { name: null, setName: null, collectorNumber: null, language: null },
      confidence: null,
      decision: null,
      dealScore: null,
      valuation: { low: null, high: null, currency: null },
      evidence: [],
      missingInformation: ["categoryHint"],
      risks: [],
      analysisId: null,
    };
    const view = mapRafAnalysisToViewModel(analysis, "general");

    expect(buildHistoryCandidateFromResultViewModel(view)).toBeNull();
  });
});
