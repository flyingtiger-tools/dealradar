import { describe, expect, it } from "vitest";
import { persistListing } from "../persist-listing";
import { FakeSupabase } from "./fake-supabase";
import type { ValidatedNormalizedListing } from "../schemas";

const SOURCE_ID = "source-ebay";

function listing(overrides: Partial<ValidatedNormalizedListing> = {}): ValidatedNormalizedListing {
  return {
    meta: {
      source: "ebay",
      externalId: "ext-1",
      originalUrl: "https://www.ebay.com/itm/1",
      collectedAt: "2026-07-26T00:00:00.000Z",
    },
    title: "LEGO Star Wars 75192",
    price: { amountCents: 84999, currency: "CHF" },
    shippingCostCents: 1500,
    condition: "new",
    categorySlug: "lego",
    attributes: { setNumber: "75192" },
    location: { country: "CH", postalCode: "8000", text: null },
    images: [],
    seller: { externalId: null, username: "seller1", feedbackScore: 100, feedbackPercentage: 99 },
    postedAt: null,
    ...overrides,
  };
}

describe("persistListing", () => {
  it("insère une nouvelle annonce et journalise le premier prix observé", async () => {
    const supabase = new FakeSupabase();
    const result = await persistListing(supabase as never, SOURCE_ID, listing());

    expect(result.outcome).toBe("inserted");
    expect(supabase.table("listings")).toHaveLength(1);
    expect(supabase.table("listings")[0]!.shipping_cost_cents).toBe(1500);
    expect(supabase.table("price_observations")).toHaveLength(1);
  });

  it("est idempotent sur un rerun identique : aucun doublon, aucune nouvelle observation de prix", async () => {
    const supabase = new FakeSupabase();
    await persistListing(supabase as never, SOURCE_ID, listing());
    const second = await persistListing(supabase as never, SOURCE_ID, listing());

    expect(second.outcome).toBe("skipped");
    expect(supabase.table("listings")).toHaveLength(1);
    expect(supabase.table("price_observations")).toHaveLength(1);
  });

  it("met à jour et journalise l'historique quand le prix change", async () => {
    const supabase = new FakeSupabase();
    await persistListing(supabase as never, SOURCE_ID, listing());
    const second = await persistListing(supabase as never, SOURCE_ID, listing({ price: { amountCents: 79999, currency: "CHF" } }));

    expect(second.outcome).toBe("updated");
    expect(supabase.table("listings")).toHaveLength(1);
    expect(supabase.table("listings")[0]!.price_cents).toBe(79999);
    expect(supabase.table("price_observations")).toHaveLength(2);
  });

  it("déduplique sur (source_id, external_id) même après plusieurs runs", async () => {
    const supabase = new FakeSupabase();
    for (let i = 0; i < 5; i += 1) {
      await persistListing(supabase as never, SOURCE_ID, listing());
    }
    expect(supabase.table("listings")).toHaveLength(1);
  });

  it("distingue deux annonces différentes de la même source", async () => {
    const supabase = new FakeSupabase();
    await persistListing(supabase as never, SOURCE_ID, listing({ meta: { ...listing().meta, externalId: "ext-1" } }));
    await persistListing(supabase as never, SOURCE_ID, listing({ meta: { ...listing().meta, externalId: "ext-2" } }));
    expect(supabase.table("listings")).toHaveLength(2);
  });

  it("persiste les images du connecteur dans listing_media (correction du gap Lot 4)", async () => {
    const supabase = new FakeSupabase();
    await persistListing(
      supabase as never,
      SOURCE_ID,
      listing({
        images: [
          { url: "https://i.ebayimg.com/1.jpg", position: 0 },
          { url: "https://i.ebayimg.com/2.jpg", position: 1 },
        ],
      }),
    );
    expect(supabase.table("listing_media")).toHaveLength(2);
  });

  it("un rerun identique n'insère jamais de doublon d'image (upsert par listing_id+source_url)", async () => {
    const supabase = new FakeSupabase();
    const withImages = listing({ images: [{ url: "https://i.ebayimg.com/1.jpg", position: 0 }] });
    await persistListing(supabase as never, SOURCE_ID, withImages);
    await persistListing(supabase as never, SOURCE_ID, withImages);
    expect(supabase.table("listing_media")).toHaveLength(1);
  });
});
