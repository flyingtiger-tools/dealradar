import { describe, expect, it } from "vitest";
import { compareEvidenceTiers, isStrongerTier, defaultTierForEvidenceType, type EvidenceQualityTier } from "../evidence-tiers";

describe("compareEvidenceTiers / isStrongerTier", () => {
  it("A > B > C > D > E, jamais une simple moyenne", () => {
    const order: EvidenceQualityTier[] = ["A", "B", "C", "D", "E"];
    for (let i = 0; i < order.length - 1; i++) {
      expect(isStrongerTier(order[i]!, order[i + 1]!)).toBe(true);
      expect(isStrongerTier(order[i + 1]!, order[i]!)).toBe(false);
    }
  });

  it("comparaison réflexive : deux paliers identiques ne sont ni plus forts ni plus faibles", () => {
    expect(compareEvidenceTiers("B", "B")).toBe(0);
    expect(isStrongerTier("B", "B")).toBe(false);
  });
});

describe("defaultTierForEvidenceType", () => {
  it("soldTransactions -> A (vente confirmée, le palier le plus fort)", () => {
    expect(defaultTierForEvidenceType("soldTransactions")).toBe("A");
  });

  it("retailPrices -> E (le palier le plus faible parmi les preuves de prix)", () => {
    expect(defaultTierForEvidenceType("retailPrices")).toBe("E");
  });

  it("productDetails/barcodeLookup/search ne portent pas de prix : palier E par défaut, jamais un palier fort inventé", () => {
    expect(defaultTierForEvidenceType("productDetails")).toBe("E");
    expect(defaultTierForEvidenceType("barcodeLookup")).toBe("E");
    expect(defaultTierForEvidenceType("search")).toBe("E");
  });

  it("hiérarchie complète attendue : soldTransactions > historicalPrices > bidAsk > activeListings > retailPrices", () => {
    expect(isStrongerTier(defaultTierForEvidenceType("soldTransactions"), defaultTierForEvidenceType("historicalPrices"))).toBe(true);
    expect(isStrongerTier(defaultTierForEvidenceType("historicalPrices"), defaultTierForEvidenceType("bidAsk"))).toBe(true);
    expect(isStrongerTier(defaultTierForEvidenceType("bidAsk"), defaultTierForEvidenceType("activeListings"))).toBe(true);
    expect(isStrongerTier(defaultTierForEvidenceType("activeListings"), defaultTierForEvidenceType("retailPrices"))).toBe(true);
  });
});
