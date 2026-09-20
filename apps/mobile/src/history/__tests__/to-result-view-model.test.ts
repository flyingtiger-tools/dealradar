import { mapHistoryEntryToResultViewModel } from "../to-result-view-model";
import type { HistoryEntry } from "../types";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    createdAt: "2026-01-01T00:00:00.000Z",
    category: "pokemon_tcg",
    identity: { name: "Pikachu", setName: "Base Set", collectorNumber: "58", language: "en", variant: null },
    verdict: null,
    marketValue: { low: 9.63, high: 9.63, currency: "CHF" },
    confidence: 97,
    source: "tcgdex",
    favorite: false,
    productKey: "pokemon_tcg|base set|58|en|",
    ...overrides,
  };
}

describe("mapHistoryEntryToResultViewModel", () => {
  it("reconstruit un ResultViewModel réutilisable par ResultScreen, toujours 'identified'", () => {
    const view = mapHistoryEntryToResultViewModel(entry());
    expect(view.identityStatus).toBe("identified");
    expect(view.category).toBe("pokemon_tcg");
    expect(view.product.name).toBe("Pikachu");
    expect(view.hasPricing).toBe(true);
    expect(view.prices[0]!.source).toBe("tcgdex");
    expect(view.isDemo).toBe(false);
  });

  it("sans marketValue : hasPricing false, aucune ligne de prix inventée", () => {
    const view = mapHistoryEntryToResultViewModel(entry({ marketValue: null }));
    expect(view.hasPricing).toBe(false);
    expect(view.prices).toEqual([]);
  });
});
