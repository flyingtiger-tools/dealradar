import { describe, expect, it } from "vitest";
import type { MarketObservation, MarketSource } from "@dealradar/connectors";
import { FakeSupabase } from "./fake-supabase";
import { orchestrateMarketIntelligence } from "../orchestrate-market-intelligence";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "bricklink",
    sourceItemId: "1",
    sourceUrl: null,
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
    marketplace: "bricklink",
    evidenceType: "historicalPrices",
    evidenceTier: "B",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

function fakeSource(source: string, observations: MarketObservation[] | (() => never)): MarketSource {
  return {
    source,
    displayName: source,
    supportedCategorySlugs: "any",
    evidenceTypes: ["historicalPrices"],
    async search() {
      if (typeof observations === "function") observations();
      return { observations: observations as MarketObservation[] };
    },
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
  };
}

const TARGET = { currency: "CHF" };

describe("orchestrateMarketIntelligence", () => {
  it("chemin complet : agrège, persiste, convertit, fusionne — status estimated", async () => {
    const source = fakeSource("bricklink", [fakeObservation()]);
    const db = new FakeSupabase();

    const result = await orchestrateMarketIntelligence({
      categorySlug: "lego",
      q: "lego 10300",
      sources: [source],
      target: TARGET,
      persistence: { supabase: db as never },
    });

    expect(result.observationCount).toBe(1);
    expect(result.persistedCount).toBe(1);
    expect(result.persistenceError).toBeNull();
    expect(result.fused.status).toBe("estimated");
    expect(result.sourceNames).toEqual(["bricklink"]);
    expect(result.historicalObservationCount).toBe(1); // evidenceType historicalPrices
    expect(result.liveObservationCount).toBe(0);
    expect(db.table("market_observations")).toHaveLength(1);
  });

  it("aucune source utilisable -> status insuffisant, jamais une exception", async () => {
    const result = await orchestrateMarketIntelligence({ categorySlug: "lego", q: "lego 10300", sources: [], target: TARGET });
    expect(result.observationCount).toBe(0);
    expect(result.fused.status).toBe("insufficient");
    expect(result.persistedCount).toBeNull(); // aucune tentative, `persistence` non fourni
  });

  it("aucune option `persistence` fournie : jamais de tentative de persistance, la fusion reste calculée normalement", async () => {
    const source = fakeSource("bricklink", [fakeObservation()]);
    const result = await orchestrateMarketIntelligence({ categorySlug: "lego", q: "lego 10300", sources: [source], target: TARGET });
    expect(result.persistedCount).toBeNull();
    expect(result.persistenceError).toBeNull();
    expect(result.fused.status).toBe("estimated");
  });

  it("table market_observations absente (migration 0018 non appliquée) : persistance refusée par ligne, jamais une exception, la fusion reste calculée", async () => {
    const source = fakeSource("bricklink", [fakeObservation()]);
    const brokenDb = {
      from() {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          upsert() { return builder; },
          maybeSingle() { return Promise.resolve({ data: null, error: { message: 'relation "market_observations" does not exist' } }); },
          then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown) {
            return Promise.resolve(onFulfilled({ data: null, error: { message: 'relation "market_observations" does not exist' } }));
          },
        };
        return builder;
      },
    };

    const result = await orchestrateMarketIntelligence({
      categorySlug: "lego",
      q: "lego 10300",
      sources: [source],
      target: TARGET,
      persistence: { supabase: brokenDb as never },
    });

    expect(result.fused.status).toBe("estimated"); // la fusion n'est jamais bloquée par une panne de persistance
    expect(result.persistedCount).toBe(0); // toutes les lignes refusées, jamais une exception qui remonte
  });

  it("une exception RÉELLEMENT levée pendant la persistance est isolée (jamais renvoyée), rapportée dans persistenceError", async () => {
    const source = fakeSource("bricklink", [fakeObservation()]);
    const throwingDb = {
      from() {
        throw new Error("panne réseau simulée vers Supabase");
      },
    };

    const result = await orchestrateMarketIntelligence({
      categorySlug: "lego",
      q: "lego 10300",
      sources: [source],
      target: TARGET,
      persistence: { supabase: throwingDb as never },
    });

    expect(result.persistenceError).toContain("panne réseau simulée");
    expect(result.fused.status).toBe("estimated");
  });

  it("une source qui échoue n'empêche jamais le calcul de la fusion à partir des autres sources", async () => {
    const working = fakeSource("bricklink", [fakeObservation()]);
    const broken = fakeSource("pricecharting", () => {
      throw new Error("panne simulée");
    });

    const result = await orchestrateMarketIntelligence({ categorySlug: "lego", q: "lego 10300", sources: [working, broken], target: TARGET });

    expect(result.sourceDiagnostics.find((d) => d.source === "pricecharting")?.status).toBe("error");
    expect(result.fused.status).toBe("estimated");
  });

  it("observations dans une devise sans taux disponible sont comptées comme écartées, jamais silencieusement absorbées", async () => {
    const source = fakeSource("bricklink", [fakeObservation({ currency: "USD" })]);
    const result = await orchestrateMarketIntelligence({ categorySlug: "lego", q: "lego 10300", sources: [source], target: TARGET });
    expect(result.skippedForCurrencyCount).toBe(1);
    expect(result.fused.status).toBe("insufficient");
  });
});
