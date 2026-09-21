import { describe, expect, it } from "vitest";
import { marketObservationDedupeKey } from "../market-observation";

describe("marketObservationDedupeKey", () => {
  it("même source/item/horodatage -> même clé", () => {
    const a = { source: "ebay", sourceItemId: "123", observedAt: "2026-09-21T00:00:00.000Z" };
    const b = { source: "ebay", sourceItemId: "123", observedAt: "2026-09-21T00:00:00.000Z" };
    expect(marketObservationDedupeKey(a)).toBe(marketObservationDedupeKey(b));
  });

  it("un prix différent au même instant reste tout de même identifié par la même clé (dédoublonnage par identité, pas par prix)", () => {
    const a = { source: "ebay", sourceItemId: "123", observedAt: "2026-09-21T00:00:00.000Z" };
    expect(marketObservationDedupeKey(a)).toBe("ebay:123:2026-09-21T00:00:00.000Z");
  });

  it("un horodatage différent produit une clé différente — une nouvelle observation dans le temps n'est jamais un doublon", () => {
    const a = { source: "ebay", sourceItemId: "123", observedAt: "2026-09-21T00:00:00.000Z" };
    const b = { source: "ebay", sourceItemId: "123", observedAt: "2026-09-22T00:00:00.000Z" };
    expect(marketObservationDedupeKey(a)).not.toBe(marketObservationDedupeKey(b));
  });

  it("des sources différentes pour le même identifiant externe ne sont jamais confondues", () => {
    const a = { source: "ebay", sourceItemId: "123", observedAt: "2026-09-21T00:00:00.000Z" };
    const b = { source: "google_shopping", sourceItemId: "123", observedAt: "2026-09-21T00:00:00.000Z" };
    expect(marketObservationDedupeKey(a)).not.toBe(marketObservationDedupeKey(b));
  });
});
