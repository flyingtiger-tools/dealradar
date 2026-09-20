jest.mock("expo-crypto", () => ({ randomUUID: () => "mock-uuid" }));

import { buildHistoryCandidateFromResultViewModel } from "../from-result-view-model";
import type { ResultViewModel } from "../../screens/result/result-view-model";

function view(overrides: Partial<ResultViewModel> = {}): ResultViewModel {
  return {
    identityStatus: "identified",
    category: "pokemon_tcg",
    product: { name: "Pikachu", setName: "Base Set", collectorNumber: "58", language: "en", variant: null, productKind: "raw_card", gradingCompany: null, grade: null },
    confidencePercent: 97,
    prices: [{ source: "tcgdex", amountCents: 963, currency: "CHF", condition: null, updatedAt: null, convertedAmountCents: null, convertedCurrency: null }],
    hasPricing: true,
    warnings: [],
    reasonMessage: null,
    decision: null,
    dealScore: null,
    reasons: [],
    isDemo: false,
    ...overrides,
  };
}

describe("buildHistoryCandidateFromResultViewModel", () => {
  it("résultat identifié avec prix : candidat complet, marketValue dérivée en CHF", () => {
    const candidate = buildHistoryCandidateFromResultViewModel(view(), "2026-01-01T00:00:00.000Z");
    expect(candidate).not.toBeNull();
    expect(candidate!.marketValue).toEqual({ low: 9.63, high: 9.63, currency: "CHF" });
    expect(candidate!.source).toBe("tcgdex");
    expect(candidate!.productKey).toContain("base set");
  });

  it("identifié SANS prix (Phase 13/14) : candidat non-null, marketValue null — jamais exclu de l'historique", () => {
    const candidate = buildHistoryCandidateFromResultViewModel(view({ prices: [], hasPricing: false }), "2026-01-01T00:00:00.000Z");
    expect(candidate).not.toBeNull();
    expect(candidate!.marketValue).toBeNull();
  });

  it("non identifié : jamais historisé", () => {
    expect(buildHistoryCandidateFromResultViewModel(view({ identityStatus: "insufficient_data" }))).toBeNull();
    expect(buildHistoryCandidateFromResultViewModel(view({ identityStatus: "failed" }))).toBeNull();
  });

  it("fixture DEMO (Phase 49) : jamais historisée, même si identifiée", () => {
    expect(buildHistoryCandidateFromResultViewModel(view({ isDemo: true }))).toBeNull();
  });

  it("catégorie non-TCG (LOT 'Universal Object Valuation Foundation') : historisée sous sa vraie catégorie, jamais 'pokemon_tcg' par défaut", () => {
    const candidate = buildHistoryCandidateFromResultViewModel(
      view({
        category: "watches",
        product: { name: "Rolex Submariner", setName: "Montres", collectorNumber: "116610LN", language: null, variant: null, productKind: null, gradingCompany: null, grade: null },
      }),
      "2026-01-01T00:00:00.000Z",
    );
    expect(candidate).not.toBeNull();
    expect(candidate!.category).toBe("watches");
    expect(candidate!.productKey.startsWith("watches|")).toBe(true);
  });
});
