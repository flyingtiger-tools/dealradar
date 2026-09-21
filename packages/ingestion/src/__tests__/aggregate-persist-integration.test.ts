import { describe, expect, it } from "vitest";
import type { MarketObservation, MarketSource } from "@dealradar/connectors";
import { FakeSupabase } from "./fake-supabase";
import { aggregateMarketObservations } from "../aggregate-market-observations";
import { persistMarketObservations } from "../persist-market-observations";

/**
 * LOT "Multi-Source Fusion + Source Wave 1", section 8 — preuve de bout en
 * bout que le résultat de `aggregateMarketObservations` (dédoublonné,
 * multi-source) peut être transmis DIRECTEMENT à `persistMarketObservations`
 * sans transformation intermédiaire, avec un client Supabase MOCKÉ
 * (`FakeSupabase`, déjà utilisé par `persist-market-observations.test.ts`)
 * — jamais un appel réseau réel, jamais la migration 0018 appliquée en
 * Production depuis ce test.
 */
function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "ebay",
    sourceItemId: "1",
    sourceUrl: "https://ebay.com/itm/1",
    observedAt: "2026-09-21T00:00:00.000Z",
    productKey: null,
    query: "lego 10300",
    title: "LEGO 10300 Back to the Future DeLorean",
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

function fakeSource(source: string, observations: MarketObservation[]): MarketSource {
  return {
    source,
    displayName: source,
    supportedCategorySlugs: "any",
    evidenceTypes: ["activeListings"],
    async search() {
      return { observations };
    },
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
  };
}

describe("aggregate -> dedupe -> persist (intégration, client Supabase mocké)", () => {
  it("agrège deux sources, dédoublonne, puis persiste toutes les observations retenues", async () => {
    const ebay = fakeSource("ebay", [fakeObservation({ source: "ebay", sourceItemId: "e1" })]);
    const bricklink = fakeSource("bricklink", [
      fakeObservation({ source: "bricklink", sourceItemId: "b1", evidenceType: "historicalPrices", evidenceTier: "B", priceAmountCents: 19500 }),
    ]);

    const aggregated = await aggregateMarketObservations({ categorySlug: "lego", sources: [ebay, bricklink], q: "lego 10300" });
    expect(aggregated.observations).toHaveLength(2);

    const db = new FakeSupabase();
    const persisted = await persistMarketObservations(db as never, "lego", aggregated.observations);

    expect(persisted.every((r) => r.outcome === "inserted")).toBe(true);
    expect(db.table("market_observations")).toHaveLength(2);
    const sources = db.table("market_observations").map((row) => row.source).sort();
    expect(sources).toEqual(["bricklink", "ebay"]);
  });

  it("une observation dupliquée entre sources (même source+item+horodatage) est dédoublonnée par l'agrégateur AVANT la persistance — une seule ligne écrite", async () => {
    const duplicate = fakeObservation({ source: "ebay", sourceItemId: "e1", observedAt: "2026-09-21T00:00:00.000Z" });
    const sourceA = fakeSource("ebay", [duplicate]);
    const sourceB = fakeSource("ebay-mirror", [{ ...duplicate }]); // même clé de dédoublonnage (source+item+horodatage) malgré un nom de connecteur différent en entrée -> le champ `source` de l'observation fait foi, pas le connecteur qui l'a rapportée.

    const aggregated = await aggregateMarketObservations({ categorySlug: "lego", sources: [sourceA, sourceB], q: "lego 10300" });
    expect(aggregated.observations).toHaveLength(1);

    const db = new FakeSupabase();
    await persistMarketObservations(db as never, "lego", aggregated.observations);
    expect(db.table("market_observations")).toHaveLength(1);
  });

  it("une source en échec ne bloque jamais la persistance des observations des autres sources", async () => {
    const working = fakeSource("ebay", [fakeObservation({ source: "ebay", sourceItemId: "e1" })]);
    const broken: MarketSource = {
      source: "bricklink",
      displayName: "bricklink",
      supportedCategorySlugs: "any",
      evidenceTypes: ["historicalPrices"],
      async search() {
        throw new Error("panne réseau simulée");
      },
      async healthCheck() {
        return { status: "ok", checkedAt: "t", latencyMs: 1 };
      },
    };

    const aggregated = await aggregateMarketObservations({ categorySlug: "lego", sources: [working, broken], q: "lego 10300" });
    expect(aggregated.diagnostics.find((d) => d.source === "bricklink")?.status).toBe("error");

    const db = new FakeSupabase();
    const persisted = await persistMarketObservations(db as never, "lego", aggregated.observations);
    expect(persisted).toEqual([{ outcome: "inserted", source: "ebay", sourceItemId: "e1" }]);
  });

  it("réexécuter le même cycle agrégation->persistance produit 'unchanged', jamais un doublon en base", async () => {
    const ebay = fakeSource("ebay", [fakeObservation({ source: "ebay", sourceItemId: "e1" })]);
    const db = new FakeSupabase();

    const firstRun = await aggregateMarketObservations({ categorySlug: "lego", sources: [ebay], q: "lego 10300" });
    await persistMarketObservations(db as never, "lego", firstRun.observations);

    const secondRun = await aggregateMarketObservations({ categorySlug: "lego", sources: [ebay], q: "lego 10300" });
    const secondPersist = await persistMarketObservations(db as never, "lego", secondRun.observations);

    expect(secondPersist[0]!.outcome).toBe("unchanged");
    expect(db.table("market_observations")).toHaveLength(1);
  });
});
