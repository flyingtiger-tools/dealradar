import { describe, expect, it } from "vitest";
import { dedupeByCanonicalOrigin } from "../canonical-origin-dedupe";
import type { MarketObservation } from "../market-observation";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "google_shopping",
    sourceItemId: "1",
    sourceUrl: null,
    observedAt: "2026-09-21T00:00:00.000Z",
    productKey: null,
    query: "iphone 13 128gb",
    title: "iPhone 13 128GB",
    brand: "Apple",
    model: "iPhone 13",
    variant: null,
    identifiers: {},
    condition: "new",
    completeness: null,
    priceAmountCents: 45000,
    currency: "CHF",
    shippingCostCents: null,
    totalPriceCents: null,
    country: "CH",
    marketplace: "fnac.ch",
    evidenceType: "retailPrices",
    evidenceTier: "E",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

describe("dedupeByCanonicalOrigin", () => {
  it("fusionne deux observations de connecteurs différents (SerpApi vs DataForSEO) pour le même marchand + UPC + prix quasi identique", () => {
    const serpApi = fakeObservation({ source: "google_shopping", sourceItemId: "s1", identifiers: { upc: "0194252707326" } });
    const dataForSeo = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "d1", identifiers: { upc: "0194252707326" }, priceAmountCents: 45050 });

    const result = dedupeByCanonicalOrigin([serpApi, dataForSeo]);

    expect(result.observations).toHaveLength(1);
    expect(result.mergedCount).toBe(1);
  });

  it("garde la preuve du palier le PLUS FORT entre les deux doublons", () => {
    const weak = fakeObservation({ source: "google_shopping", sourceItemId: "s1", identifiers: { upc: "123" }, evidenceTier: "E" });
    const strong = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "d1", identifiers: { upc: "123" }, evidenceType: "activeListings", evidenceTier: "D" });

    const result = dedupeByCanonicalOrigin([weak, strong]);

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.evidenceTier).toBe("D");
  });

  it("jamais de fusion sans identifiant structurel fiable — même titre/marchand/prix ne suffisent pas", () => {
    const a = fakeObservation({ source: "google_shopping", sourceItemId: "a1", identifiers: {} });
    const b = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "b1", identifiers: {} });

    const result = dedupeByCanonicalOrigin([a, b]);

    expect(result.observations).toHaveLength(2);
    expect(result.mergedCount).toBe(0);
  });

  it("jamais de fusion entre marchands différents, même identifiant identique", () => {
    const a = fakeObservation({ source: "google_shopping", sourceItemId: "a1", identifiers: { upc: "123" }, marketplace: "fnac.ch" });
    const b = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "b1", identifiers: { upc: "123" }, marketplace: "digitec.ch" });

    const result = dedupeByCanonicalOrigin([a, b]);

    expect(result.observations).toHaveLength(2);
  });

  it("jamais de fusion neuf vs occasion, même marchand et identifiant", () => {
    const newOne = fakeObservation({ source: "google_shopping", sourceItemId: "a1", identifiers: { upc: "123" }, condition: "new" });
    const used = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "b1", identifiers: { upc: "123" }, condition: "used" });

    const result = dedupeByCanonicalOrigin([newOne, used]);

    expect(result.observations).toHaveLength(2);
  });

  it("jamais de fusion entre devises différentes", () => {
    const chf = fakeObservation({ source: "google_shopping", sourceItemId: "a1", identifiers: { upc: "123" }, currency: "CHF" });
    const usd = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "b1", identifiers: { upc: "123" }, currency: "USD" });

    const result = dedupeByCanonicalOrigin([chf, usd]);

    expect(result.observations).toHaveLength(2);
  });

  it("jamais de fusion si le prix diverge au-delà de la tolérance (2%)", () => {
    const a = fakeObservation({ source: "google_shopping", sourceItemId: "a1", identifiers: { upc: "123" }, priceAmountCents: 45000 });
    const b = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "b1", identifiers: { upc: "123" }, priceAmountCents: 50000 });

    const result = dedupeByCanonicalOrigin([a, b]);

    expect(result.observations).toHaveLength(2);
  });

  it("variante différente (storage/size) reste distincte même même marchand — préservé via un identifiant MPN distinct", () => {
    const iphone128 = fakeObservation({ source: "google_shopping", sourceItemId: "a1", identifiers: { mpn: "iphone13-128" } });
    const iphone256 = fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "b1", identifiers: { mpn: "iphone13-256" } });

    const result = dedupeByCanonicalOrigin([iphone128, iphone256]);

    expect(result.observations).toHaveLength(2);
  });

  it("liste vide -> résultat vide", () => {
    expect(dedupeByCanonicalOrigin([])).toEqual({ observations: [], mergedCount: 0 });
  });

  it("une seule observation -> inchangée", () => {
    const observation = fakeObservation({ identifiers: { upc: "123" } });
    expect(dedupeByCanonicalOrigin([observation])).toEqual({ observations: [observation], mergedCount: 0 });
  });
});
