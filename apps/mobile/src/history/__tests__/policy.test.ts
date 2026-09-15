import { isImmediateDuplicate, shouldAddToHistory } from "../policy";
import type { HistoryEntry } from "../types";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    createdAt: "2026-01-01T00:00:00.000Z",
    category: "pokemon_tcg",
    identity: { name: "Pikachu", setName: "Base Set", collectorNumber: "58", language: "en", variant: null },
    verdict: null,
    marketValue: null,
    confidence: 97,
    source: "tcgdex",
    favorite: false,
    productKey: "pokemon_tcg|base set|58|en|",
    ...overrides,
  };
}

describe("isImmediateDuplicate / shouldAddToHistory", () => {
  it("même clé, 5 secondes plus tard : doublon immédiat détecté", () => {
    const existing = [entry({ createdAt: "2026-01-01T00:00:00.000Z" })];
    const candidate = { productKey: "pokemon_tcg|base set|58|en|", createdAt: "2026-01-01T00:00:05.000Z" };
    expect(isImmediateDuplicate(existing, candidate)).toBe(true);
    expect(shouldAddToHistory(existing, candidate)).toBe(false);
  });

  it("même clé, largement après la fenêtre : plus un doublon, un nouveau scan légitime", () => {
    const existing = [entry({ createdAt: "2026-01-01T00:00:00.000Z" })];
    const candidate = { productKey: "pokemon_tcg|base set|58|en|", createdAt: "2026-01-01T01:00:00.000Z" };
    expect(isImmediateDuplicate(existing, candidate)).toBe(false);
    expect(shouldAddToHistory(existing, candidate)).toBe(true);
  });

  it("clé différente : jamais un doublon, quel que soit le délai", () => {
    const existing = [entry({ productKey: "pokemon_tcg|jungle|1|en|" })];
    const candidate = { productKey: "pokemon_tcg|base set|58|en|", createdAt: "2026-01-01T00:00:01.000Z" };
    expect(shouldAddToHistory(existing, candidate)).toBe(true);
  });

  it("historique vide : jamais un doublon", () => {
    expect(shouldAddToHistory([], { productKey: "any", createdAt: new Date().toISOString() })).toBe(true);
  });
});
