import { describe, expect, it, vi } from "vitest";
import { createEbayMarketSourceAdapter } from "../market-source-adapter";
import type { MarketplaceConnector, NormalizedListing } from "../../types";

function fakeListing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    meta: {
      source: "ebay",
      externalId: "v1|123|0",
      originalUrl: "https://www.ebay.com/itm/123",
      collectedAt: "2026-09-21T00:00:00.000Z",
      rawPayloadRef: { itemId: "v1|123|0" },
    },
    title: "LEGO Star Wars 75192 New Sealed",
    price: { amountCents: 84999, currency: "CHF" },
    shippingCostCents: 990,
    condition: "new",
    categorySlug: "lego",
    attributes: {},
    location: { country: "CH", postalCode: null, text: null },
    images: [],
    seller: { externalId: null, username: "seller1", feedbackScore: null, feedbackPercentage: null },
    postedAt: null,
    ...overrides,
  };
}

function fakeConnector(listings: NormalizedListing[], overrides: Partial<MarketplaceConnector> = {}): MarketplaceConnector {
  return {
    source: "ebay",
    capabilities: ["search", "itemDetails"],
    async search() {
      return { listings, total: listings.length, offset: 0, limit: 50, hasMore: false };
    },
    async getItem() {
      return null;
    },
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 10 };
    },
    ...overrides,
  };
}

describe("createEbayMarketSourceAdapter", () => {
  it("déclare activeListings/search/productDetails, jamais soldTransactions", () => {
    const adapter = createEbayMarketSourceAdapter(fakeConnector([]));
    expect(adapter.evidenceTypes).toContain("activeListings");
    expect(adapter.evidenceTypes).not.toContain("soldTransactions");
  });

  it("une annonce active eBay devient une MarketObservation palier D, jamais A/B/C", async () => {
    const adapter = createEbayMarketSourceAdapter(fakeConnector([fakeListing()]));
    const result = await adapter.search({ categorySlug: "lego", q: "lego 75192" });

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.evidenceTier).toBe("D");
    expect(result.observations[0]!.evidenceType).toBe("activeListings");
  });

  it("soldAt n'est jamais inventé pour une annonce active eBay", async () => {
    const adapter = createEbayMarketSourceAdapter(fakeConnector([fakeListing()]));
    const result = await adapter.search({ categorySlug: "lego", q: "lego 75192" });
    expect(result.observations[0]!.soldAt).toBeNull();
  });

  it("conserve source URL/id/condition/frais de port quand connus", async () => {
    const adapter = createEbayMarketSourceAdapter(fakeConnector([fakeListing()]));
    const result = await adapter.search({ categorySlug: "lego", q: "lego 75192" });
    const obs = result.observations[0]!;
    expect(obs.sourceUrl).toBe("https://www.ebay.com/itm/123");
    expect(obs.sourceItemId).toBe("v1|123|0");
    expect(obs.condition).toBe("new");
    expect(obs.shippingCostCents).toBe(990);
    expect(obs.totalPriceCents).toBe(84999 + 990);
  });

  it("rejette une annonce sans état exploitable, jamais un état deviné", async () => {
    const adapter = createEbayMarketSourceAdapter(fakeConnector([fakeListing({ condition: null })]));
    const result = await adapter.search({ categorySlug: "lego", q: "lego 75192" });
    expect(result.observations).toEqual([]);
  });

  it("transmet q/categorySlug/limit au connecteur eBay existant, sans dupliquer sa logique", async () => {
    const searchSpy = vi.fn().mockResolvedValue({ listings: [], total: 0, offset: 0, limit: 10, hasMore: false });
    const adapter = createEbayMarketSourceAdapter(fakeConnector([], { search: searchSpy }));

    await adapter.search({ categorySlug: "watches", q: "rolex submariner", limit: 10 });

    expect(searchSpy).toHaveBeenCalledWith({ q: "rolex submariner", categorySlug: "watches", limit: 10 });
  });

  it("healthCheck() délègue au connecteur eBay existant, jamais réimplémenté", async () => {
    const healthCheckSpy = vi.fn().mockResolvedValue({ status: "down", checkedAt: "t", latencyMs: null, message: "auth failed" });
    const adapter = createEbayMarketSourceAdapter(fakeConnector([], { healthCheck: healthCheckSpy }));

    const health = await adapter.healthCheck();

    expect(healthCheckSpy).toHaveBeenCalledTimes(1);
    expect(health.status).toBe("down");
  });

  it("hasMore du connecteur eBay est préservé tel quel", async () => {
    const adapter = createEbayMarketSourceAdapter(fakeConnector([fakeListing()], { async search() { return { listings: [fakeListing()], total: 100, offset: 0, limit: 1, hasMore: true }; } }));
    const result = await adapter.search({ categorySlug: "lego", q: "lego" });
    expect(result.hasMore).toBe(true);
  });
});
