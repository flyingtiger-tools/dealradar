import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type {
  CatalogConnector,
  CatalogMatch,
  FxRate,
  FxRateProvider,
  NormalizedPriceObservation,
  PricingConnector,
  TcgCatalogHints,
} from "@dealradar/connectors";
import { orchestratePokemonPipeline } from "../orchestrate-pokemon-pipeline";
import { FakeSupabase } from "./fake-supabase";

const CATEGORY_SLUG = "pokemon_tcg";
const PIKACHU_HINTS: TcgCatalogHints = {
  name: "Pikachu",
  setName: "Base Set",
  setCode: "base4",
  collectorNumber: "58",
  extra: { variant: "Normal" },
  language: "English",
};

function pokemonCatalogMatch(overrides: Partial<CatalogMatch> = {}): CatalogMatch {
  return {
    item: {
      source: "pokemon-tcg-api",
      externalId: "base4-58",
      kind: "raw_card",
      categorySlug: CATEGORY_SLUG,
      name: "Pikachu",
      canonicalAttributes: { setId: "base4", setName: "Base Set", collectorNumber: "58" },
      images: [],
      externalUrl: null,
    },
    confidence: 1,
    matchedOn: ["name", "setName", "setCode", "collectorNumber"],
    ...overrides,
  };
}

function tcgdexCatalogMatch(overrides: Partial<CatalogMatch> = {}): CatalogMatch {
  return {
    item: {
      source: "tcgdex",
      externalId: "base1-58",
      kind: "raw_card",
      categorySlug: CATEGORY_SLUG,
      name: "Pikachu",
      canonicalAttributes: { setId: "base1", setName: "Base Set", collectorNumber: "58" },
      images: [],
      externalUrl: null,
    },
    confidence: 1,
    matchedOn: ["name", "setName", "collectorNumber"],
    ...overrides,
  };
}

function justTcgObservation(overrides: Partial<NormalizedPriceObservation> = {}): NormalizedPriceObservation {
  return {
    source: "justtcg",
    externalProductId: "v_normal",
    game: "Pokémon",
    name: "Pikachu",
    setName: "Base Set",
    setId: "base4",
    number: "58",
    variant: "Normal",
    language: "English",
    condition: "Near Mint",
    gradingCompany: null,
    grade: null,
    amountCents: 150,
    currency: "USD",
    priceType: "market_aggregate",
    updatedAt: "2026-07-30T00:00:00.000Z",
    region: "US",
    provenance: "justtcg-api-v2",
    confidence: 1,
    warnings: ["Prix en USD, marché nord-américain (JustTCG) — ne représente pas une valeur de marché suisse ou européenne."],
    ...overrides,
  };
}

function tcgdexObservation(overrides: Partial<NormalizedPriceObservation> = {}): NormalizedPriceObservation {
  return {
    source: "tcgdex",
    externalProductId: "base1-58:cardmarket:normal",
    game: "Pokémon",
    name: "Pikachu",
    setName: "Base Set",
    // Jamais l'id de set interne TCGdex (non comparable entre sources, voir pricing/tcgdex/normalize.ts).
    setId: null,
    number: "58",
    variant: "Normal",
    language: "English",
    condition: null,
    gradingCompany: null,
    grade: null,
    amountCents: 130,
    currency: "EUR",
    priceType: "market_aggregate",
    updatedAt: "2026-08-01T00:00:00.000Z",
    region: "EU",
    provenance: "tcgdex-cardmarket",
    confidence: 1,
    warnings: ["Prix Cardmarket en EUR (TCGdex) — n'est jamais automatiquement un prix de marché suisse (CHF)."],
    ...overrides,
  };
}

function fxRate(overrides: Partial<FxRate> = {}): FxRate {
  return {
    baseCurrency: "USD",
    quoteCurrency: "CHF",
    rate: 0.9,
    rateDate: new Date().toISOString().slice(0, 10),
    source: "frankfurter",
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeCatalogConnector(source: string, matches: CatalogMatch[]): CatalogConnector {
  return {
    source,
    displayName: source,
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: [CATEGORY_SLUG],
    declaredQuality: { reliability: 80, coverage: 40, freshness: 70, latency: 70, confidence: 60 },
    cost: { model: "free", details: "N/A" },
    quotas: {},
    license: { allowsCommercialUse: true, allowsCaching: true, maxCacheAgeHours: 24, allowsRedistribution: false, termsUrl: "https://example.test" },
    cachePolicy: { ttlHours: 24, staleWhileRevalidate: true },
    healthCheck: async () => ({ status: "ok", checkedAt: new Date().toISOString(), latencyMs: 5 }),
    resolve: vi.fn().mockResolvedValue(matches),
    getItem: vi.fn().mockResolvedValue(null),
  };
}

function fakePricingConnector(source: string, observations: NormalizedPriceObservation[]): PricingConnector {
  return {
    source,
    displayName: source,
    family: "pricing",
    capabilities: ["pricing.lookup.v1"],
    supportedCategorySlugs: [CATEGORY_SLUG],
    declaredQuality: { reliability: 80, coverage: 45, freshness: 85, latency: 75, confidence: 65 },
    cost: { model: "free", details: "N/A" },
    quotas: {},
    license: { allowsCommercialUse: true, allowsCaching: true, maxCacheAgeHours: null, allowsRedistribution: false, termsUrl: "https://example.test" },
    cachePolicy: { ttlHours: 12, staleWhileRevalidate: true },
    healthCheck: async () => ({ status: "ok", checkedAt: new Date().toISOString(), latencyMs: 5 }),
    lookup: vi.fn().mockResolvedValue(observations),
  };
}

function fakeFxProvider(rate: FxRate | null): FxRateProvider {
  return { source: rate?.source ?? "frankfurter", getRate: vi.fn().mockResolvedValue(rate) };
}

describe("orchestratePokemonPipeline", () => {
  it("bout en bout réussi : catalogue corroboré, deux sources de prix distinctes, conversion CHF de secours", async () => {
    const supabase = new FakeSupabase();
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation()]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation()]),
      fxProvider: fakeFxProvider(fxRate({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9 })),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    const candidate = result.candidate!;

    // Catalogue corroboré par les deux sources.
    expect(candidate.catalogSources.sort()).toEqual(["pokemon-tcg-api", "tcgdex"]);

    // Deux observations de prix distinctes, jamais moyennées.
    expect(candidate.priceObservations).toHaveLength(2);
    expect(candidate.priceObservations.map((o) => o.currency).sort()).toEqual(["EUR", "USD"]);

    // Conversion indicative produite (ni USD ni EUR n'est CHF).
    expect(candidate.conversion).not.toBeNull();
    expect(candidate.warnings.some((w) => w.toLowerCase().includes("indicative"))).toBe(true);

    expect(supabase.table("tcg_price_observations")).toHaveLength(2);
    expect(supabase.table("fx_rates")).toHaveLength(1);
  });

  it("cible EUR déjà couverte par TCGdex : aucune conversion Frankfurter déclenchée", async () => {
    const supabase = new FakeSupabase();
    const fxProvider = fakeFxProvider(fxRate());
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation()]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation()]),
      fxProvider,
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "EUR",
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    expect(result.candidate!.conversion).toBeNull();
    expect(fxProvider.getRate).not.toHaveBeenCalled();
    expect(supabase.table("fx_rates")).toHaveLength(0);
  });

  it("aucune identification catalogue : s'arrête proprement, rien n'est persisté", async () => {
    const supabase = new FakeSupabase();
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", []),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", []),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation()]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation()]),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: { name: "Carte inconnue" },
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("catalog_no_match");
    expect(supabase.table("tcg_price_observations")).toHaveLength(0);
  });

  it("divergence Pokémon TCG API / TCGdex sur le set : refusé, jamais résolu sur une seule source silencieusement", async () => {
    const supabase = new FakeSupabase();
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [
        tcgdexCatalogMatch({ item: { ...tcgdexCatalogMatch().item, canonicalAttributes: { setId: "base2", setName: "Jungle", collectorNumber: "58" } } }),
      ]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation()]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation()]),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("catalog_diverged");
    expect(result.candidate).toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes("divergence"))).toBe(true);
    expect(supabase.table("tcg_price_observations")).toHaveLength(0);
  });

  it("un seul catalogue disponible (TCGdex hors service) : identité non corroborée mais toujours exploitée", async () => {
    const supabase = new FakeSupabase();
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", []),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation()]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", []),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    expect(result.candidate!.catalogSources).toEqual(["pokemon-tcg-api"]);
    expect(result.candidate!.priceObservations).toHaveLength(1);
  });

  it("divergence de prix TCGdex / JustTCG : les deux observations restent séparées, jamais moyennées", async () => {
    const supabase = new FakeSupabase();
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation({ amountCents: 150 })]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation({ amountCents: 900 })]), // valeur très différente, volontairement
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "GBP",
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    const amounts = result.candidate!.priceObservations.map((o) => o.amountCents).sort((a, b) => a - b);
    expect(amounts).toEqual([150, 900]);
    // Aucune moyenne arbitraire : ni 150, ni 900 ne sont recalculés en une valeur unique.
    expect(result.candidate!.priceObservations).toHaveLength(2);
  });

  it("cross_match_refused : aucune source de pricing ne produit d'exact_match", async () => {
    const supabase = new FakeSupabase();
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", []),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", []),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("cross_match_refused");
    expect(supabase.table("tcg_price_observations")).toHaveLength(0);
  });

  it("taux de conversion de secours trop ancien : le candidat reste exploitable sans conversion", async () => {
    const supabase = new FakeSupabase();
    const staleRate = fxRate({ rateDate: "2020-01-01" });
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation()]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation()]),
      fxProvider: fakeFxProvider(staleRate),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
      maxFxRateAgeHours: 48,
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    expect(result.candidate!.conversion).toBeNull();
    expect(result.candidate!.warnings.some((w) => w.toLowerCase().includes("conversion indicative impossible"))).toBe(true);
    // Les prix USD/EUR restent persistés malgré l'échec de conversion.
    expect(supabase.table("tcg_price_observations")).toHaveLength(2);
  });

  it("n'importe aucun symbole de @dealradar/core — aucune décision BUY/REVIEW/PASS possible depuis ce module", () => {
    const modulePath = fileURLToPath(new URL("../orchestrate-pokemon-pipeline.ts", import.meta.url));
    const source = readFileSync(modulePath, "utf-8");
    expect(source).not.toMatch(/from ["']@dealradar\/core["']/);
  });
});
