import { describe, expect, it, vi } from "vitest";
import type { MarketObservation, MarketSource, FxRate, FxRateProvider } from "@dealradar/connectors";
import { createCanonicalProductIdentity, mergeIdentityEvidence, KNOWN_SOURCE_QUERY_PROFILES } from "@dealradar/core";
import { FakeSupabase } from "./fake-supabase";
import { takeMarketSnapshot } from "../take-market-snapshot";

const ASOF = "2026-09-21T00:00:00.000Z";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "bricklink",
    sourceItemId: "1",
    sourceUrl: null,
    observedAt: ASOF,
    productKey: null,
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

function fakeSource(source: string, search: MarketSource["search"]): MarketSource {
  return {
    source,
    displayName: source,
    supportedCategorySlugs: "any",
    evidenceTypes: ["historicalPrices"],
    search,
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
  };
}

function legoIdentity() {
  return mergeIdentityEvidence(createCanonicalProductIdentity("lego", "lego:10300"), {
    source: "user_scan",
    confidence: 0.9,
    observedAt: ASOF,
    fields: { bricklinkNo: "10300", brand: "LEGO" },
  }).identity;
}

describe("takeMarketSnapshot", () => {
  it("construit un plan PAR IDENTIFIANT pour chaque source disponible et interroge chacune avec CE plan", async () => {
    const search = vi.fn().mockResolvedValue({ observations: [fakeObservation()] });
    const bricklink = fakeSource("bricklink", search);

    const result = await takeMarketSnapshot({
      identity: legoIdentity(),
      categorySlug: "lego",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [bricklink],
    });

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ hints: { bricklinkNo: "10300" } }));
    expect(result.searchPlansUsed.map((p) => p.source)).toContain("bricklink");
    expect(result.summary.observationCount).toBe(1);
  });

  it("aucune identité exploitable -> aucun plan, aucune source interrogée", async () => {
    const search = vi.fn().mockResolvedValue({ observations: [] });
    const bricklink = fakeSource("bricklink", search);

    const result = await takeMarketSnapshot({
      identity: createCanonicalProductIdentity("lego"),
      categorySlug: "lego",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [bricklink],
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.searchPlansUsed).toEqual([]);
  });

  it("dédoublonne les offres provenant de deux connecteurs différents pour la MÊME origine canonique", async () => {
    const identity = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "user_scan",
      confidence: 0.9,
      observedAt: ASOF,
      fields: { upc: "0194252707326", brand: "Apple", model: "iPhone 13" },
    }).identity;

    const serpApi = fakeSource("google_shopping", async () => ({
      observations: [fakeObservation({ source: "google_shopping", sourceItemId: "s1", marketplace: "fnac.ch", identifiers: { upc: "0194252707326" }, priceAmountCents: 45000 })],
    }));
    const dataForSeo = fakeSource("dataforseo_google_shopping", async () => ({
      observations: [fakeObservation({ source: "dataforseo_google_shopping", sourceItemId: "d1", marketplace: "fnac.ch", identifiers: { upc: "0194252707326" }, priceAmountCents: 45010 })],
    }));

    const result = await takeMarketSnapshot({
      identity,
      categorySlug: "apple",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [serpApi, dataForSeo],
    });

    expect(result.summary.observationCount).toBe(1); // les deux offres fusionnées en une seule origine canonique
  });

  it("persiste les observations avec leur devise D'ORIGINE, jamais réécrite par la normalisation du résumé", async () => {
    const db = new FakeSupabase();
    const source = fakeSource("bricklink", async () => ({ observations: [fakeObservation({ currency: "CHF" })] }));

    await takeMarketSnapshot({
      identity: legoIdentity(),
      categorySlug: "lego",
      desiredCurrency: "USD", // devise DÉSIRÉE différente de la devise observée
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [source],
      persistence: { supabase: db as never },
    });

    const row = db.table("market_observations")[0] as { currency: string };
    expect(row.currency).toBe("CHF"); // jamais convertie en USD dans la ligne persistée
  });

  it("persiste l'identité canonique (fraîcheur last_seen_at)", async () => {
    const db = new FakeSupabase();
    const source = fakeSource("bricklink", async () => ({ observations: [fakeObservation()] }));

    const result = await takeMarketSnapshot({
      identity: legoIdentity(),
      categorySlug: "lego",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [source],
      persistence: { supabase: db as never },
    });

    expect(result.identityPersisted).toBe(true);
    expect(db.table("market_products")).toHaveLength(1);
  });

  it("normalise le RÉSUMÉ via un fxRateProvider, sans jamais toucher les lignes persistées", async () => {
    const db = new FakeSupabase();
    const source = fakeSource("keepa", async () => ({ observations: [fakeObservation({ source: "keepa", currency: "USD", priceAmountCents: 10000 })] }));
    const fxProvider: FxRateProvider = { source: "fake", getRate: vi.fn().mockResolvedValue({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9, rateDate: "2026-09-20", source: "fake", fetchedAt: ASOF } satisfies FxRate) };

    const result = await takeMarketSnapshot({
      identity: mergeIdentityEvidence(createCanonicalProductIdentity("gaming", "gaming:x"), { source: "test", confidence: 0.9, observedAt: ASOF, fields: { asin: "B00X" } }).identity,
      categorySlug: "gaming",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [source],
      fxRateProvider: fxProvider,
      persistence: { supabase: db as never },
    });

    expect(result.summary.normalizedRange?.medianCents).toBe(9000);
    expect((db.table("market_observations")[0] as { currency: string }).currency).toBe("USD");
  });

  it("aucune décision utilisateur calculée — le résultat n'expose jamais de champ decision/BUY/PASS", async () => {
    const source = fakeSource("bricklink", async () => ({ observations: [fakeObservation()] }));
    const result = await takeMarketSnapshot({
      identity: legoIdentity(),
      categorySlug: "lego",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [source],
    });
    expect(result).not.toHaveProperty("decision");
    expect(result).not.toHaveProperty("fused");
  });

  it("idempotent : ré-exécuter le même instantané ne duplique jamais les lignes persistées", async () => {
    const db = new FakeSupabase();
    const source = fakeSource("bricklink", async () => ({ observations: [fakeObservation()] }));
    const runOnce = () =>
      takeMarketSnapshot({
        identity: legoIdentity(),
        categorySlug: "lego",
        desiredCurrency: "CHF",
        sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
        sources: [source],
        persistence: { supabase: db as never },
      });

    await runOnce();
    await runOnce();

    expect(db.table("market_observations")).toHaveLength(1);
    expect(db.table("market_products")).toHaveLength(1);
  });

  it("panne d'une source isolée : les autres continuent, jamais un blocage de l'instantané", async () => {
    const working = fakeSource("bricklink", async () => ({ observations: [fakeObservation()] }));
    const broken = fakeSource("keepa", async () => {
      throw new Error("panne simulée");
    });

    const identity = mergeIdentityEvidence(legoIdentity(), { source: "test", confidence: 0.9, observedAt: ASOF, fields: { asin: "B00X" } }).identity;

    const result = await takeMarketSnapshot({
      identity,
      categorySlug: "lego",
      desiredCurrency: "CHF",
      sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
      sources: [working, broken],
    });

    expect(result.coverageReport.sourcesFailed).toBe(1);
    expect(result.coverageReport.sourcesSucceeded).toBe(1);
    expect(result.summary.observationCount).toBe(1);
  });
});
