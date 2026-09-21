import { describe, expect, it } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import { FakeSupabase } from "./fake-supabase";
import { persistMarketObservations } from "../persist-market-observations";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "ebay",
    sourceItemId: "1",
    sourceUrl: "https://ebay.com/itm/1",
    observedAt: "2026-09-21T00:00:00.000Z",
    productKey: null,
    query: "nintendo switch",
    title: "Nintendo Switch OLED",
    brand: "Nintendo",
    model: "Switch OLED",
    variant: null,
    identifiers: {},
    condition: "very_good",
    completeness: null,
    priceAmountCents: 25000,
    currency: "CHF",
    shippingCostCents: null,
    totalPriceCents: null,
    country: "CH",
    marketplace: "ebay",
    evidenceType: "activeListings",
    evidenceTier: "D",
    soldAt: null,
    matchScore: 0.9,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

describe("persistMarketObservations", () => {
  it("insère une nouvelle observation", async () => {
    const db = new FakeSupabase();
    const results = await persistMarketObservations(db as never, "gaming", [fakeObservation()]);

    expect(results).toEqual([{ outcome: "inserted", source: "ebay", sourceItemId: "1" }]);
    expect(db.table("market_observations")).toHaveLength(1);
    expect(db.table("market_observations")[0]!.category_slug).toBe("gaming");
  });

  it("la même observation (source+item+horodatage) écrite deux fois fusionne en place, jamais un doublon", async () => {
    const db = new FakeSupabase();
    await persistMarketObservations(db as never, "gaming", [fakeObservation()]);
    const second = await persistMarketObservations(db as never, "gaming", [fakeObservation()]);

    expect(second[0]!.outcome).toBe("unchanged");
    expect(db.table("market_observations")).toHaveLength(1);
  });

  it("un nouvel horodatage pour le même item crée une nouvelle ligne d'historique, jamais un écrasement", async () => {
    const db = new FakeSupabase();
    await persistMarketObservations(db as never, "gaming", [fakeObservation({ observedAt: "2026-09-21T00:00:00.000Z" })]);
    await persistMarketObservations(db as never, "gaming", [fakeObservation({ observedAt: "2026-09-22T00:00:00.000Z", priceAmountCents: 24000 })]);

    expect(db.table("market_observations")).toHaveLength(2);
  });

  it("une observation invalide (prix négatif) est rejetée, jamais persistée, sans bloquer les autres", async () => {
    const db = new FakeSupabase();
    const results = await persistMarketObservations(db as never, "gaming", [
      fakeObservation({ sourceItemId: "bad", priceAmountCents: -100 }),
      fakeObservation({ sourceItemId: "good" }),
    ]);

    expect(results[0]!.outcome).toBe("refused");
    expect(results[1]!.outcome).toBe("inserted");
    expect(db.table("market_observations")).toHaveLength(1);
  });

  it("observation sans sourceItemId : rejetée avec une raison explicite", async () => {
    const db = new FakeSupabase();
    const results = await persistMarketObservations(db as never, "gaming", [fakeObservation({ sourceItemId: "" })]);
    expect(results[0]!.outcome).toBe("refused");
    expect(results[0]!.reason).toContain("sourceItemId");
  });

  it("liste vide : résultat vide, jamais une exception", async () => {
    const db = new FakeSupabase();
    expect(await persistMarketObservations(db as never, "gaming", [])).toEqual([]);
  });

  it("préserve sold_at null (jamais déduit) et le palier de preuve tels quels", async () => {
    const db = new FakeSupabase();
    await persistMarketObservations(db as never, "gaming", [fakeObservation({ evidenceType: "soldTransactions", evidenceTier: "A", soldAt: "2026-09-20T00:00:00.000Z" })]);
    const row = db.table("market_observations")[0]!;
    expect(row.sold_at).toBe("2026-09-20T00:00:00.000Z");
    expect(row.evidence_tier).toBe("A");
  });
});
