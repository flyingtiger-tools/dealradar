import { describe, expect, it, vi } from "vitest";
import type { MarketplaceConnector, NormalizedListing, SearchQuery, SearchResult } from "@dealradar/connectors";
import { gatherActiveListingEvidence } from "../gather-active-listing-evidence";

function connectorListing(externalId: string, overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    meta: { source: "ebay", externalId, originalUrl: `https://ebay.example/${externalId}`, collectedAt: "2026-09-20T00:00:00.000Z" },
    title: `Item ${externalId}`,
    price: { amountCents: 10000, currency: "CHF" },
    shippingCostCents: null,
    condition: "good",
    categorySlug: "general",
    attributes: {},
    location: { country: null, postalCode: null, text: null },
    images: [],
    seller: { externalId: null, username: null, feedbackScore: null, feedbackPercentage: null },
    postedAt: null,
    ...overrides,
  };
}

function fakeConnector(searchImpl: (query: SearchQuery) => Promise<SearchResult>, capabilities: MarketplaceConnector["capabilities"] = ["search", "itemDetails"]): MarketplaceConnector {
  return {
    source: "fake",
    capabilities,
    search: vi.fn(searchImpl),
    getItem: vi.fn(async () => null),
    healthCheck: vi.fn(async () => ({ status: "ok" as const, checkedAt: "now", latencyMs: 1 })),
  };
}

describe("gatherActiveListingEvidence", () => {
  it("retourne un pool vide si le connecteur ne déclare pas la capacité search", async () => {
    const connector = fakeConnector(async () => ({ listings: [], total: 0, offset: 0, limit: 10, hasMore: false }), ["itemDetails"]);
    const result = await gatherActiveListingEvidence({ connector, categorySlug: "general", queries: { exact: "iPhone 13", fallbacks: [] } });
    expect(result).toEqual([]);
    expect(connector.search).not.toHaveBeenCalled();
  });

  it("retourne un pool vide si la requête exacte est vide, jamais une recherche à l'aveugle", async () => {
    const connector = fakeConnector(async () => ({ listings: [], total: 0, offset: 0, limit: 10, hasMore: false }));
    const result = await gatherActiveListingEvidence({ connector, categorySlug: "general", queries: { exact: "", fallbacks: ["something"] } });
    expect(result).toEqual([]);
    expect(connector.search).not.toHaveBeenCalled();
  });

  it("normalise chaque annonce en NormalizedComparable avec soldAt: null (jamais présenté comme une vente)", async () => {
    const connector = fakeConnector(async () => ({
      listings: [connectorListing("1"), connectorListing("2")],
      total: 2,
      offset: 0,
      limit: 25,
      hasMore: false,
    }));
    const result = await gatherActiveListingEvidence({ connector, categorySlug: "general", queries: { exact: "iPhone 13", fallbacks: [] } });
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.soldAt === null)).toBe(true);
    expect(connector.search).toHaveBeenCalledTimes(1);
    expect(connector.search).toHaveBeenCalledWith(expect.objectContaining({ q: "iPhone 13", categorySlug: "general" }));
  });

  it("rejette une annonce sans état exploitable, jamais une condition devinée", async () => {
    const connector = fakeConnector(async () => ({
      listings: [connectorListing("1", { condition: null })],
      total: 1,
      offset: 0,
      limit: 25,
      hasMore: false,
    }));
    const result = await gatherActiveListingEvidence({ connector, categorySlug: "general", queries: { exact: "x", fallbacks: [] } });
    expect(result).toEqual([]);
  });

  it("essaie les replis dans l'ordre uniquement si la requête exacte n'atteint pas stopAfterCount", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({ listings: [connectorListing("1")], total: 1, offset: 0, limit: 25, hasMore: false })
      .mockResolvedValueOnce({ listings: [connectorListing("2"), connectorListing("3")], total: 2, offset: 0, limit: 25, hasMore: false });
    const connector = fakeConnector(search);
    const result = await gatherActiveListingEvidence({
      connector,
      categorySlug: "general",
      queries: { exact: "Nike Air Jordan 1 Chicago size 10", fallbacks: ["Nike Air Jordan 1"] },
      stopAfterCount: 3,
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.map((c) => c.id).sort()).toEqual(["ebay:1", "ebay:2", "ebay:3"]);
  });

  it("ne tente pas de repli une fois stopAfterCount atteint par la requête exacte seule", async () => {
    const search = vi.fn().mockResolvedValueOnce({
      listings: [connectorListing("1"), connectorListing("2")],
      total: 2,
      offset: 0,
      limit: 25,
      hasMore: false,
    });
    const connector = fakeConnector(search);
    const result = await gatherActiveListingEvidence({
      connector,
      categorySlug: "general",
      queries: { exact: "iPhone 13", fallbacks: ["iPhone"] },
      stopAfterCount: 2,
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });

  it("déduplique par source:id entre requêtes qui se chevauchent", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({ listings: [connectorListing("1")], total: 1, offset: 0, limit: 25, hasMore: false })
      .mockResolvedValueOnce({ listings: [connectorListing("1"), connectorListing("2")], total: 2, offset: 0, limit: 25, hasMore: false });
    const connector = fakeConnector(search);
    const result = await gatherActiveListingEvidence({
      connector,
      categorySlug: "general",
      queries: { exact: "a", fallbacks: ["b"] },
      stopAfterCount: 10,
    });
    expect(result.map((c) => c.id).sort()).toEqual(["ebay:1", "ebay:2"]);
  });

  it("respecte maxQueriesAttempted même si stopAfterCount n'est jamais atteint", async () => {
    const search = vi.fn().mockResolvedValue({ listings: [], total: 0, offset: 0, limit: 25, hasMore: false });
    const connector = fakeConnector(search);
    await gatherActiveListingEvidence({
      connector,
      categorySlug: "general",
      queries: { exact: "a", fallbacks: ["b", "c", "d", "e"] },
      maxQueriesAttempted: 2,
    });
    expect(search).toHaveBeenCalledTimes(2);
  });
});
