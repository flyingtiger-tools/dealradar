import { describe, expect, it } from "vitest";
import { normalizeEbayItem } from "../normalize";
import type { EbayRawItemSummary, EbayRawItem } from "../raw-types";

const CONTEXT = { categorySlug: "lego", collectedAt: "2026-07-26T00:00:00.000Z" };

function rawItem(overrides: Partial<EbayRawItemSummary> = {}): EbayRawItemSummary {
  return {
    itemId: "v1|123456789|0",
    title: "LEGO Star Wars 75192 Millennium Falcon",
    price: { value: "849.99", currency: "CHF" },
    itemWebUrl: "https://www.ebay.com/itm/123456789",
    condition: "New",
    seller: { username: "brick_seller", feedbackScore: 1200, feedbackPercentage: "99.5" },
    itemLocation: { country: "CH", postalCode: "8000" },
    ...overrides,
  };
}

describe("normalizeEbayItem", () => {
  it("normalise un item complet", () => {
    const listing = normalizeEbayItem(rawItem(), CONTEXT);
    expect(listing).not.toBeNull();
    expect(listing?.meta.source).toBe("ebay");
    expect(listing?.meta.externalId).toBe("v1|123456789|0");
    expect(listing?.price).toEqual({ amountCents: 84999, currency: "CHF" });
    expect(listing?.condition).toBe("new");
    expect(listing?.categorySlug).toBe("lego");
    expect(listing?.seller.username).toBe("brick_seller");
  });

  it("retourne null pour un payload incomplet (prix manquant) plutôt que d'inventer une valeur", () => {
    const listing = normalizeEbayItem(rawItem({ price: undefined }), CONTEXT);
    expect(listing).toBeNull();
  });

  it("retourne null si l'identifiant externe est absent", () => {
    const listing = normalizeEbayItem(rawItem({ itemId: undefined }), CONTEXT);
    expect(listing).toBeNull();
  });

  it("laisse condition à null pour un libellé eBay non reconnu, sans deviner", () => {
    const listing = normalizeEbayItem(rawItem({ condition: "Some Unknown Condition Label" }), CONTEXT);
    expect(listing?.condition).toBeNull();
  });

  it("conserve une devise étrangère telle quelle, sans conversion", () => {
    const listing = normalizeEbayItem(rawItem({ price: { value: "199.00", currency: "USD" } }), CONTEXT);
    expect(listing?.price).toEqual({ amountCents: 19900, currency: "USD" });
  });

  it("gère l'absence de vendeur/localisation/images sans planter", () => {
    const listing = normalizeEbayItem(
      rawItem({ seller: undefined, itemLocation: undefined, image: undefined, additionalImages: undefined }),
      CONTEXT,
    );
    expect(listing?.seller).toEqual({
      externalId: null,
      username: null,
      feedbackScore: null,
      feedbackPercentage: null,
    });
    expect(listing?.location).toEqual({ country: null, postalCode: null, text: null });
    expect(listing?.images).toEqual([]);
  });

  it("reprend les aspects localisés tels quels dans attributes, sans les faire correspondre aux clés internes", () => {
    const raw: EbayRawItem = {
      ...rawItem(),
      localizedAspects: [{ name: "Set Number", value: "75192" }],
    };
    const listing = normalizeEbayItem(raw, CONTEXT);
    expect(listing?.attributes).toEqual({ "Set Number": "75192" });
  });

  it("minimise le raw_payload conservé (pas le JSON brut complet)", () => {
    const raw = rawItem({ shortDescription: "Description très longue à ne pas stocker intégralement." });
    const listing = normalizeEbayItem(raw, CONTEXT);
    const stored = listing?.meta.rawPayloadRef as Record<string, unknown>;
    expect(stored).not.toHaveProperty("shortDescription");
    expect(stored).toMatchObject({ itemId: "v1|123456789|0", title: raw.title });
  });
});
