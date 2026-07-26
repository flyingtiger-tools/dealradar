import { describe, expect, it } from "vitest";
import { runListing, buildComparablePool } from "../run-listing";
import type { DatasetItem, DatasetComparable } from "../../dataset/schema";

const ASOF = "2026-07-26T00:00:00.000Z";

describe("runListing", () => {
  it("identifie un LEGO au format eBay réel sans appel IA (déterministe suffisant)", async () => {
    const item: DatasetItem = {
      raw: {
        itemId: "t-1",
        title: "LEGO Star Wars 75313 AT-AT",
        price: { value: "849.99", currency: "CHF" },
        condition: "New",
      },
      expected: { sufficientDeterministic: true },
    };

    const result = await runListing(item, {
      categorySlug: "lego",
      asOf: ASOF,
      imageDomainAllowlist: [],
      candidatePool: [],
    });

    expect(result.usable).toBe(true);
    expect(result.extractionSource).toBe("deterministic");
    expect(result.sufficiencyCorrect).toBe(true);
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("retourne usable=false pour un item eBay inutilisable (titre vide), jamais un crash", async () => {
    const item: DatasetItem = { raw: { itemId: "t-2", title: "", price: { value: "10", currency: "CHF" } } };
    const result = await runListing(item, { categorySlug: "lego", asOf: ASOF, imageDomainAllowlist: [], candidatePool: [] });
    expect(result.usable).toBe(false);
    expect(result.decision).toBeNull();
  });

  it("atteint une décision autre que INSUFFICIENT_DATA quand un pool de comparables est fourni", async () => {
    const comparables: DatasetComparable[] = Array.from({ length: 5 }, (_, i) => ({
      raw: {
        itemId: `comp-${i}`,
        title: "LEGO Star Wars 75313 AT-AT vendu",
        price: { value: "800.00", currency: "CHF" },
        condition: "New",
        localizedAspects: [{ name: "setNumber", value: "75313" }],
      },
      soldAt: "2026-06-01T00:00:00.000Z",
    }));
    const pool = buildComparablePool(comparables, "lego", ASOF);
    expect(pool).toHaveLength(5);

    const item: DatasetItem = {
      raw: {
        itemId: "t-3",
        title: "LEGO Star Wars 75313 AT-AT",
        price: { value: "700.00", currency: "CHF" },
        condition: "New",
      },
    };
    const result = await runListing(item, { categorySlug: "lego", asOf: ASOF, imageDomainAllowlist: [], candidatePool: pool });
    expect(result.decision).not.toBe("INSUFFICIENT_DATA");
  });

  it("mesure des temps de phase cohérents (mapping + extraction <= total)", async () => {
    const item: DatasetItem = {
      raw: { itemId: "t-4", title: "LEGO Star Wars 75313 AT-AT", price: { value: "849.99", currency: "CHF" } },
    };
    const result = await runListing(item, { categorySlug: "lego", asOf: ASOF, imageDomainAllowlist: [], candidatePool: [] });
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(result.timings.mappingMs);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(result.timings.extractionMs);
  });
});
