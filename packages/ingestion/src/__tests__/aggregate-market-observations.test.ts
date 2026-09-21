import { describe, expect, it, vi } from "vitest";
import type { MarketObservation, MarketSource } from "@dealradar/connectors";
import { aggregateMarketObservations } from "../aggregate-market-observations";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "ebay",
    sourceItemId: "1",
    sourceUrl: null,
    observedAt: "2026-09-21T00:00:00.000Z",
    productKey: null,
    query: "q",
    title: "Item",
    brand: null,
    model: null,
    variant: null,
    identifiers: {},
    condition: "good",
    completeness: null,
    priceAmountCents: 1000,
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

function fakeSource(source: string, impl: Partial<MarketSource> & { search: MarketSource["search"] }): MarketSource {
  return {
    source,
    displayName: source,
    supportedCategorySlugs: "any",
    evidenceTypes: ["activeListings"],
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
    ...impl,
  };
}

describe("aggregateMarketObservations", () => {
  it("agrège les observations de plusieurs sources qui réussissent toutes", async () => {
    const sourceA = fakeSource("a", { async search() { return { observations: [fakeObservation({ source: "a", sourceItemId: "1" })] }; } });
    const sourceB = fakeSource("b", { async search() { return { observations: [fakeObservation({ source: "b", sourceItemId: "2" })] }; } });

    const result = await aggregateMarketObservations({ categorySlug: "gaming", sources: [sourceA, sourceB], q: "test" });

    expect(result.observations).toHaveLength(2);
    expect(result.diagnostics.every((d) => d.status === "success")).toBe(true);
  });

  it("une source qui échoue ne fait jamais échouer les autres ni l'agrégation globale", async () => {
    const sourceA = fakeSource("a", { async search() { return { observations: [fakeObservation({ source: "a" })] }; } });
    const sourceB = fakeSource("b", {
      async search() {
        throw new Error("panne réseau simulée");
      },
    });

    const result = await aggregateMarketObservations({ categorySlug: "gaming", sources: [sourceA, sourceB], q: "test" });

    expect(result.observations).toHaveLength(1);
    const diagB = result.diagnostics.find((d) => d.source === "b");
    expect(diagB?.status).toBe("error");
    expect(diagB?.errorMessage).toContain("panne réseau simulée");
  });

  it("une source qui dépasse son budget de temps est marquée timeout, jamais bloquante pour les autres", async () => {
    const slow = fakeSource("slow", {
      async search() {
        return new Promise((resolve) => setTimeout(() => resolve({ observations: [fakeObservation({ source: "slow" })] }), 500));
      },
    });
    const fast = fakeSource("fast", { async search() { return { observations: [fakeObservation({ source: "fast" })] }; } });

    const result = await aggregateMarketObservations({ categorySlug: "gaming", sources: [slow, fast], q: "test", perSourceTimeoutMs: 20 });

    const diagSlow = result.diagnostics.find((d) => d.source === "slow");
    expect(diagSlow?.status).toBe("timeout");
    expect(result.observations.map((o) => o.source)).toEqual(["fast"]);
  });

  it("dédoublonne les observations identiques (même source+item+horodatage) même si plusieurs sources les rapportent", async () => {
    const duplicate = fakeObservation({ source: "a", sourceItemId: "1", observedAt: "2026-09-21T00:00:00.000Z" });
    const sourceA = fakeSource("a", { async search() { return { observations: [duplicate, { ...duplicate }] }; } });

    const result = await aggregateMarketObservations({ categorySlug: "gaming", sources: [sourceA], q: "test" });

    expect(result.observations).toHaveLength(1);
  });

  it("fusionne une même offre restituée par deux agrégateurs différents (SerpApi vs DataForSEO, même marchand/UPC/prix) — jamais comptée deux fois (LOT Source Wave 3)", async () => {
    const serpApiObservation = fakeObservation({
      source: "google_shopping",
      sourceItemId: "s1",
      marketplace: "fnac.ch",
      identifiers: { upc: "0194252707326" },
      priceAmountCents: 45000,
    });
    const dataForSeoObservation = fakeObservation({
      source: "dataforseo_google_shopping",
      sourceItemId: "d1",
      marketplace: "fnac.ch",
      identifiers: { upc: "0194252707326" },
      priceAmountCents: 45020,
    });
    const serpApi = fakeSource("google_shopping", { async search() { return { observations: [serpApiObservation] }; } });
    const dataForSeo = fakeSource("dataforseo_google_shopping", { async search() { return { observations: [dataForSeoObservation] }; } });

    const result = await aggregateMarketObservations({ categorySlug: "apple", sources: [serpApi, dataForSeo], q: "test" });

    expect(result.observations).toHaveLength(1);
    expect(result.canonicalOriginMergedCount).toBe(1);
  });

  it("aucune source : résultat vide, jamais une exception (aucune source n'est obligatoire)", async () => {
    const result = await aggregateMarketObservations({ categorySlug: "gaming", sources: [], q: "test" });
    expect(result.observations).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("respecte la concurrence bornée : jamais plus de maxConcurrency exécutions simultanées", async () => {
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const sources = Array.from({ length: 6 }, (_, i) =>
      fakeSource(`s${i}`, {
        async search() {
          inFlight += 1;
          maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 10));
          inFlight -= 1;
          return { observations: [] };
        },
      }),
    );

    await aggregateMarketObservations({ categorySlug: "gaming", sources, q: "test", maxConcurrency: 2 });

    expect(maxObservedInFlight).toBeLessThanOrEqual(2);
  });

  it("transmet q/categorySlug/country/hints tels quels à chaque source, jamais reconstruits", async () => {
    const searchSpy = vi.fn().mockResolvedValue({ observations: [] });
    const source = fakeSource("a", { search: searchSpy });

    await aggregateMarketObservations({ categorySlug: "watches", sources: [source], q: "rolex submariner", country: "ch", hints: { brand: "Rolex" } });

    expect(searchSpy).toHaveBeenCalledWith({ categorySlug: "watches", q: "rolex submariner", hints: { brand: "Rolex" }, country: "ch", limit: undefined });
  });
});
