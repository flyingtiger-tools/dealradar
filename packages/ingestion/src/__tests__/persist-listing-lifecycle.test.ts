import { describe, expect, it } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import { FakeSupabase } from "./fake-supabase";
import { reconcileAndPersistListingLifecycles } from "../persist-listing-lifecycle";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "ebay",
    sourceItemId: "1",
    sourceUrl: null,
    observedAt: "2026-09-21T00:00:00.000Z",
    productKey: "lego:10300",
    query: "10300",
    title: "LEGO 10300",
    brand: "LEGO",
    model: "10300",
    variant: null,
    identifiers: {},
    condition: "new",
    completeness: null,
    priceAmountCents: 18000,
    currency: "CHF",
    shippingCostCents: null,
    totalPriceCents: null,
    country: "CH",
    marketplace: "ebay",
    evidenceType: "activeListings",
    evidenceTier: "D",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

describe("reconcileAndPersistListingLifecycles", () => {
  it("initialise le cycle de vie d'une annonce jamais vue et le persiste", async () => {
    const db = new FakeSupabase();
    const result = await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1" })],
      asOf: "2026-09-21T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });

    expect(result.upsertedCount).toBe(1);
    const row = db.table("listing_lifecycles")[0] as { source: string; source_item_id: string; observed_count: number; currently_seen: boolean };
    expect(row.source).toBe("ebay");
    expect(row.source_item_id).toBe("1");
    expect(row.observed_count).toBe(1);
    expect(row.currently_seen).toBe(true);
  });

  it("une annonce revue au cycle suivant incrémente observed_count, jamais un doublon", async () => {
    const db = new FakeSupabase();
    await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1", observedAt: "2026-09-20T00:00:00.000Z" })],
      asOf: "2026-09-20T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1", observedAt: "2026-09-21T00:00:00.000Z" })],
      asOf: "2026-09-21T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });

    expect(db.table("listing_lifecycles")).toHaveLength(1);
    const row = db.table("listing_lifecycles")[0] as { observed_count: number };
    expect(row.observed_count).toBe(2);
  });

  it("une annonce absente au-delà du seuil de disparition est marquée disparue, JAMAIS vendue", async () => {
    const db = new FakeSupabase();
    await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1", observedAt: "2026-09-19T00:00:00.000Z" })],
      asOf: "2026-09-19T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    // Cycle suivant, 72h plus tard, l'annonce n'est plus observée du tout.
    const result = await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [],
      asOf: "2026-09-22T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });

    expect(result.states[0]?.currentlySeen).toBe(false);
    expect(result.states[0]?.disappearedAt).toBe("2026-09-19T00:00:00.000Z");
    expect(result.states[0]?.confirmedSoldAt).toBeNull();
  });

  it("un premier cycle manqué SOUS le seuil ne marque jamais disparue immédiatement", async () => {
    const db = new FakeSupabase();
    await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1", observedAt: "2026-09-21T00:00:00.000Z" })],
      asOf: "2026-09-21T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    const result = await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [],
      asOf: "2026-09-21T12:00:00.000Z", // seulement 12h plus tard, sous le seuil de 48h.
      disappearanceRuleHours: 48,
    });

    expect(result.states[0]?.currentlySeen).toBe(true);
    expect(result.states[0]?.disappearedAt).toBeNull();
  });

  it("une réapparition efface l'état disparu tout en préservant first_seen_at historique", async () => {
    const db = new FakeSupabase();
    await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1", observedAt: "2026-09-19T00:00:00.000Z" })],
      asOf: "2026-09-19T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [],
      asOf: "2026-09-22T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });
    const result = await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1", observedAt: "2026-09-25T00:00:00.000Z" })],
      asOf: "2026-09-25T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });

    expect(result.states[0]?.currentlySeen).toBe(true);
    expect(result.states[0]?.disappearedAt).toBeNull();
    expect(result.states[0]?.firstSeenAt).toBe("2026-09-19T00:00:00.000Z");
  });

  it("ne réconcilie/relit jamais les annonces d'un AUTRE produit (scopé par product_key)", async () => {
    const db = new FakeSupabase();
    db.seed("listing_lifecycles", [
      {
        id: "x",
        source: "ebay",
        source_item_id: "other-1",
        product_key: "apple:iphone-13",
        first_seen_at: "2026-09-01T00:00:00.000Z",
        last_seen_at: "2026-09-01T00:00:00.000Z",
        observed_count: 1,
        currently_seen: true,
        disappeared_at: null,
        confirmed_sold_at: null,
      },
    ]);

    const result = await reconcileAndPersistListingLifecycles({
      supabase: db as never,
      productKey: "lego:10300",
      observations: [fakeObservation({ sourceItemId: "1" })],
      asOf: "2026-09-21T00:00:00.000Z",
      disappearanceRuleHours: 48,
    });

    expect(result.states).toHaveLength(1);
    expect(result.states[0]?.listingKey).toBe("ebay:1");
  });
});
