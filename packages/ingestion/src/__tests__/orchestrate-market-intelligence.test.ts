import { describe, expect, it, vi } from "vitest";
import type { MarketObservation, MarketSource, FxRate, FxRateProvider } from "@dealradar/connectors";
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

function fakeSource(source: string, observations: MarketObservation[] | (() => never), overrides: Partial<MarketSource> = {}): MarketSource {
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
    ...overrides,
  };
}

function fakeFxRateProvider(getRate: FxRateProvider["getRate"]): FxRateProvider {
  return { source: "fake-fx", getRate };
}

function fakeFxRate(overrides: Partial<FxRate> = {}): FxRate {
  return { baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-09-21", source: "fake-fx", fetchedAt: "2026-09-21T00:00:00.000Z", ...overrides };
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

  it("fxRateProvider résout automatiquement un taux pour une devise étrangère réellement observée, jamais devinée", async () => {
    const source = fakeSource("keepa", [fakeObservation({ source: "keepa", currency: "USD", priceAmountCents: 10000 })]);
    const getRate = vi.fn().mockResolvedValue(fakeFxRate({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9 }));

    const result = await orchestrateMarketIntelligence({
      categorySlug: "gaming",
      q: "x",
      sources: [source],
      target: TARGET,
      fxRateProvider: fakeFxRateProvider(getRate),
    });

    expect(result.skippedForCurrencyCount).toBe(0);
    expect(result.fused.status).toBe("estimated");
    expect(result.fused.fairCents).toBe(9000);
    expect(getRate).toHaveBeenCalledWith("USD", "CHF", undefined);
  });

  it("succès de la fusion multi-devise : USD (Keepa) + EUR + CHF contribuent ensemble à une fusion en CHF via des taux explicites horodatés", async () => {
    const usdSource = fakeSource("keepa", [fakeObservation({ source: "keepa", sourceItemId: "u1", currency: "USD", priceAmountCents: 10000 })]);
    const eurSource = fakeSource("pricecharting", [fakeObservation({ source: "pricecharting", sourceItemId: "e1", currency: "EUR", priceAmountCents: 9500 })]);
    const chfSource = fakeSource("bricklink", [fakeObservation({ source: "bricklink", sourceItemId: "c1", currency: "CHF", priceAmountCents: 9800 })]);

    const getRate = vi.fn().mockImplementation(async (base: string, quote: string) => {
      if (base === "USD" && quote === "CHF") return fakeFxRate({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-09-20" });
      if (base === "EUR" && quote === "CHF") return fakeFxRate({ baseCurrency: "EUR", quoteCurrency: "CHF", rate: 0.95, rateDate: "2026-09-20" });
      return null;
    });

    const result = await orchestrateMarketIntelligence({
      categorySlug: "gaming",
      q: "x",
      sources: [usdSource, eurSource, chfSource],
      target: TARGET,
      fxRateProvider: fakeFxRateProvider(getRate),
    });

    expect(result.skippedForCurrencyCount).toBe(0);
    expect(result.fused.status).toBe("estimated");
    expect(result.fused.evidenceCount).toBe(3);
    expect(result.fx.observedCurrencies.sort()).toEqual(["CHF", "EUR", "USD"]);
    expect(result.fx.ratesUsed).toHaveLength(2); // USD->CHF et EUR->CHF, jamais un 3e taux inventé pour CHF->CHF
    expect(result.fx.ratesUsed.every((r) => r.rateDate === "2026-09-20")).toBe(true);
  });

  it("un taux fourni explicitement dans fxRates n'est JAMAIS écrasé par une résolution automatique", async () => {
    const source = fakeSource("keepa", [fakeObservation({ source: "keepa", currency: "USD", priceAmountCents: 10000 })]);
    const getRate = vi.fn().mockResolvedValue(fakeFxRate({ rate: 0.5 })); // taux auto délibérément différent pour détecter une éventuelle substitution

    const result = await orchestrateMarketIntelligence({
      categorySlug: "gaming",
      q: "x",
      sources: [source],
      target: TARGET,
      fxRates: { USD: fakeFxRate({ rate: 0.9 }) },
      fxRateProvider: fakeFxRateProvider(getRate),
    });

    expect(result.fused.fairCents).toBe(9000); // 10000 * 0.9 (fxRates manuel), jamais 10000 * 0.5 (auto)
    expect(getRate).not.toHaveBeenCalled(); // la devise USD est déjà couverte par fxRates, jamais interrogée en plus
  });

  it("directSourceCount / aggregatorSourceCount distinguent les connecteurs directs des agrégateurs (MarketSource.sourceKind)", async () => {
    const direct = fakeSource("bricklink", [fakeObservation({ source: "bricklink" })]);
    const aggregator = fakeSource("google_shopping", [fakeObservation({ source: "google_shopping", sourceItemId: "g1", marketplace: "fnac.ch" })], { sourceKind: "aggregator" });

    const result = await orchestrateMarketIntelligence({ categorySlug: "lego", q: "lego 10300", sources: [direct, aggregator], target: TARGET });

    expect(result.directSourceCount).toBe(1);
    expect(result.aggregatorSourceCount).toBe(1);
  });

  it("evidenceTypeMix reflète la répartition réelle par type de preuve", async () => {
    const source = fakeSource("bricklink", [
      fakeObservation({ sourceItemId: "1", evidenceType: "historicalPrices" }),
      fakeObservation({ sourceItemId: "2", evidenceType: "activeListings", evidenceTier: "D" }),
    ]);

    const result = await orchestrateMarketIntelligence({ categorySlug: "lego", q: "lego 10300", sources: [source], target: TARGET });

    expect(result.evidenceTypeMix).toEqual(
      expect.arrayContaining([
        { evidenceType: "historicalPrices", count: 1 },
        { evidenceType: "activeListings", count: 1 },
      ]),
    );
  });

  it("costClassesUsed reflète les sources INTERROGÉES, même celles qui n'ont produit aucune observation", async () => {
    const cheap = fakeSource("pricecharting", []);
    const result = await orchestrateMarketIntelligence({ categorySlug: "gaming", q: "x", sources: [cheap], target: TARGET });
    expect(result.costClassesUsed).toEqual(["cheap"]);
  });

  it("audit FX (LOT Historical Data Engine, section 11) : chaque taux effectivement utilisé est persisté via persistFxRate", async () => {
    const source = fakeSource("keepa", [fakeObservation({ source: "keepa", currency: "USD", priceAmountCents: 10000 })]);
    const getRate = vi.fn().mockResolvedValue(fakeFxRate({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9 }));
    const db = new FakeSupabase();

    const result = await orchestrateMarketIntelligence({
      categorySlug: "gaming",
      q: "x",
      sources: [source],
      target: TARGET,
      fxRateProvider: fakeFxRateProvider(getRate),
      persistence: { supabase: db as never },
    });

    expect(result.fxRatesPersistedCount).toBe(1);
    expect(result.fxPersistenceError).toBeNull();
    expect(db.table("fx_rates")).toHaveLength(1);
  });

  it("panne de persistance FX isolée : jamais renvoyée comme exception, jamais un blocage de la fusion", async () => {
    const source = fakeSource("keepa", [fakeObservation({ source: "keepa", currency: "USD", priceAmountCents: 10000 })]);
    const getRate = vi.fn().mockResolvedValue(fakeFxRate({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9 }));
    const throwingDb = { from() { throw new Error("panne réseau simulée vers fx_rates"); } };

    const result = await orchestrateMarketIntelligence({
      categorySlug: "gaming",
      q: "x",
      sources: [source],
      target: TARGET,
      fxRateProvider: fakeFxRateProvider(getRate),
      persistence: { supabase: throwingDb as never },
    });

    expect(result.fxPersistenceError).toContain("panne réseau simulée");
    expect(result.fused.status).toBe("estimated"); // la fusion n'est jamais bloquée par une panne d'audit FX
  });

  it("aucun taux utilisé (toutes les observations déjà dans la devise cible) : jamais de tentative de persistance FX", async () => {
    const source = fakeSource("bricklink", [fakeObservation()]); // déjà en CHF
    const db = new FakeSupabase();

    const result = await orchestrateMarketIntelligence({ categorySlug: "lego", q: "x", sources: [source], target: TARGET, persistence: { supabase: db as never } });

    expect(result.fxRatesPersistedCount).toBeNull();
    expect(db.table("fx_rates")).toEqual([]);
  });

  it("sans option `persistence` : jamais de tentative de persistance FX, même avec un fxRateProvider fourni", async () => {
    const source = fakeSource("keepa", [fakeObservation({ source: "keepa", currency: "USD" })]);
    const getRate = vi.fn().mockResolvedValue(fakeFxRate());

    const result = await orchestrateMarketIntelligence({ categorySlug: "gaming", q: "x", sources: [source], target: TARGET, fxRateProvider: fakeFxRateProvider(getRate) });

    expect(result.fxRatesPersistedCount).toBeNull();
  });
});
