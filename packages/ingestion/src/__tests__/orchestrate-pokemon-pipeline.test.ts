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

function fakeFailingCatalogConnector(source: string, error: Error): CatalogConnector {
  const connector = fakeCatalogConnector(source, []);
  connector.resolve = vi.fn().mockRejectedValue(error);
  return connector;
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

/** Variante multi-devises — résout un taux différent selon la paire demandée, pour exercer une conversion indicative par observation (LOT 7C-bis). */
function fakeMultiFxProvider(ratesByPair: Record<string, FxRate | null>): FxRateProvider {
  return {
    source: "frankfurter",
    getRate: vi.fn(async (base: string, quote: string) => ratesByPair[`${base}->${quote}`] ?? null),
  };
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

    // L'observation USD reçoit une conversion indicative (le taux fourni est USD→CHF).
    const usdEntry = candidate.priceObservations.find((o) => o.currency === "USD")!;
    expect(usdEntry.conversion).not.toBeNull();
    expect(usdEntry.conversion!.convertedCurrency).toBe("CHF");
    // Les montants natifs ne sont jamais modifiés par la conversion.
    expect(usdEntry.amountCents).toBe(150);
    expect(candidate.warnings.some((w) => w.toLowerCase().includes("indicative"))).toBe(true);

    expect(supabase.table("tcg_price_observations")).toHaveLength(2);
    expect(supabase.table("fx_rates")).toHaveLength(1);
  });

  it("cible EUR déjà couverte nativement par TCGdex : l'observation EUR native reste inchangée, mais l'observation USD reçoit quand même une conversion EUR indicative (LOT 7C-bis)", async () => {
    const supabase = new FakeSupabase();
    const fxProvider = fakeMultiFxProvider({
      "USD->EUR": fxRate({ baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.85 }),
    });
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
    const candidate = result.candidate!;
    // Une observation EUR native n'empêche jamais la conversion indicative des autres devises.
    expect(fxProvider.getRate).toHaveBeenCalledWith("USD", "EUR");
    const eurEntry = candidate.priceObservations.find((o) => o.currency === "EUR")!;
    const usdEntry = candidate.priceObservations.find((o) => o.currency === "USD")!;
    // L'observation déjà native dans la devise cible n'est jamais "convertie vers elle-même".
    expect(eurEntry.conversion).toBeNull();
    expect(eurEntry.amountCents).toBe(130);
    // L'observation USD reçoit sa propre conversion indicative vers EUR.
    expect(usdEntry.conversion).not.toBeNull();
    expect(usdEntry.conversion!.convertedCurrency).toBe("EUR");
    expect(supabase.table("fx_rates")).toHaveLength(1);
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

  it("une observation CHF native + USD + EUR : chaque devise non native reçoit sa propre conversion CHF indicative, la native reste inchangée (LOT 7C-bis)", async () => {
    const supabase = new FakeSupabase();
    const fxProvider = fakeMultiFxProvider({
      "USD->CHF": fxRate({ baseCurrency: "USD", quoteCurrency: "CHF", rate: 0.9 }),
      "EUR->CHF": fxRate({ baseCurrency: "EUR", quoteCurrency: "CHF", rate: 0.95 }),
    });
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [
        justTcgObservation({ externalProductId: "v_usd", currency: "USD", condition: "Near Mint", amountCents: 700 }),
        justTcgObservation({ externalProductId: "v_chf", currency: "CHF", condition: "Lightly Played", amountCents: 500 }),
      ]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation({ currency: "EUR", amountCents: 600 })]),
      fxProvider,
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    const candidate = result.candidate!;
    expect(candidate.priceObservations).toHaveLength(3);

    const chfEntry = candidate.priceObservations.find((o) => o.currency === "CHF")!;
    const usdEntry = candidate.priceObservations.find((o) => o.currency === "USD")!;
    const eurEntry = candidate.priceObservations.find((o) => o.currency === "EUR")!;

    // Native CHF : jamais "convertie vers elle-même", montant inchangé.
    expect(chfEntry.conversion).toBeNull();
    expect(chfEntry.amountCents).toBe(500);
    // USD et EUR reçoivent CHACUNE leur propre conversion indicative — la présence du CHF natif ne les bloque pas.
    expect(usdEntry.conversion).not.toBeNull();
    expect(usdEntry.conversion!.convertedCurrency).toBe("CHF");
    expect(eurEntry.conversion).not.toBeNull();
    expect(eurEntry.conversion!.convertedCurrency).toBe("CHF");
    // Aucun montant natif modifié par la conversion.
    expect(usdEntry.amountCents).toBe(700);
    expect(eurEntry.amountCents).toBe(600);

    expect(fxProvider.getRate).toHaveBeenCalledWith("USD", "CHF");
    expect(fxProvider.getRate).toHaveBeenCalledWith("EUR", "CHF");
    expect(fxProvider.getRate).not.toHaveBeenCalledWith("CHF", "CHF");
    expect(supabase.table("fx_rates")).toHaveLength(2);
  });

  it("Holo + Reverse Holo sans variante fixée par l'identité : persistées ensemble, jamais moyennées ni résolues en une seule variante — candidate.variant reste null avec un avertissement explicite (LOT 7C-bis)", async () => {
    const supabase = new FakeSupabase();
    const hintsNoVariant: TcgCatalogHints = { name: "Pikachu", setName: "Base Set", setCode: "base4", collectorNumber: "58", language: "English" };
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [
        justTcgObservation({ externalProductId: "v_holo", variant: "Holofoil", amountCents: 500 }),
        justTcgObservation({ externalProductId: "v_reverse", variant: "Reverse Holofoil", amountCents: 800 }),
      ]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", []),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: hintsNoVariant,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    const candidate = result.candidate!;
    expect(candidate.priceObservations).toHaveLength(2);
    expect(candidate.priceObservations.map((o) => o.variant).sort()).toEqual(["Holofoil", "Reverse Holofoil"]);
    // Jamais résolu en une seule variante — jamais un choix arbitraire ; le
    // détail segmenté reste dans `priceObservations` (équivalent d'une
    // fourchette segmentée, à charge du futur moteur de décision de demander
    // une précision plutôt que de trancher lui-même).
    expect(candidate.variant).toBeNull();
    expect(candidate.warnings.some((w) => w.toLowerCase().includes("plusieurs variantes"))).toBe(true);
    // Jamais moyennées : les deux montants natifs restent distincts.
    expect(candidate.priceObservations.map((o) => o.amountCents).sort((a, b) => a - b)).toEqual([500, 800]);
  });

  it("PSA9 + PSA10 sans grade fixé par l'identité : persistées ensemble, jamais moyennées ni résolues en un seul grade — candidate.grade reste null avec un avertissement explicite (LOT 7C-bis)", async () => {
    const supabase = new FakeSupabase();
    const gradedHints: TcgCatalogHints = { name: "Pikachu", setName: "Base Set", setCode: "base4", collectorNumber: "58", language: "English", gradingCompany: "PSA" };
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeCatalogConnector("pokemon-tcg-api", [pokemonCatalogMatch()]),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      justTcgPricingConnector: fakePricingConnector("justtcg", [
        justTcgObservation({ externalProductId: "v_psa9", variant: null, condition: null, gradingCompany: "PSA", grade: "PSA 9", amountCents: 32_000 }),
        justTcgObservation({ externalProductId: "v_psa10", variant: null, condition: null, gradingCompany: "PSA", grade: "PSA 10", amountCents: 120_000 }),
      ]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", []),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: gradedHints,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("ready_for_intelligence_core");
    const candidate = result.candidate!;
    expect(candidate.priceObservations).toHaveLength(2);
    expect(candidate.priceObservations.map((o) => o.grade).sort()).toEqual(["PSA 10", "PSA 9"]);
    expect(candidate.grade).toBeNull();
    expect(candidate.warnings.some((w) => w.toLowerCase().includes("plusieurs grades"))).toBe(true);
    expect(candidate.priceObservations.map((o) => o.amountCents).sort((a, b) => a - b)).toEqual([32_000, 120_000]);
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
    expect(result.candidate!.priceObservations.every((o) => o.conversion === null)).toBe(true);
    expect(result.candidate!.warnings.some((w) => w.toLowerCase().includes("conversion indicative impossible"))).toBe(true);
    // Les prix USD/EUR restent persistés malgré l'échec de conversion.
    expect(supabase.table("tcg_price_observations")).toHaveLength(2);
    expect(supabase.table("fx_rates")).toHaveLength(0);
  });

  it("Pokémon TCG API indisponible (5xx après retries) : jamais de crash, jamais de correspondance inventée, repli TCGdex à confiance plafonnée — même avec plusieurs observations de prix fortes sur plusieurs sources, jamais de candidat exploitable pour un verdict BUY/PASS", async () => {
    const supabase = new FakeSupabase();
    const pokemonError = Object.assign(new Error("Pokémon TCG API a répondu 500 après 4 tentative(s)."), { httpStatus: 500, retryable: true });
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeFailingCatalogConnector("pokemon-tcg-api", pokemonError),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", [tcgdexCatalogMatch()]),
      // Volontairement plusieurs observations fortes, multi-sources, multi-devises,
      // toutes par ailleurs "parfaites" (confiance 1, aucune ambiguïté propre) —
      // seule la confiance d'IDENTITÉ plafonnée à 0.5 doit bloquer exact_match,
      // jamais la qualité ou le nombre des observations de prix elles-mêmes.
      justTcgPricingConnector: fakePricingConnector("justtcg", [
        justTcgObservation({ externalProductId: "v_nm", condition: "Near Mint", amountCents: 700 }),
        justTcgObservation({ externalProductId: "v_lp", condition: "Lightly Played", amountCents: 300 }),
      ]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", [tcgdexObservation()]),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
    });

    // Jamais un exact_match multi-catalogue quand la corroboration normalement
    // requise (Pokémon TCG API) était indisponible — la confiance plafonnée
    // (0.5) rend `exact_match` structurellement inatteignable dans
    // `classifyCrossMatch` (qui exige `identity.confidence === 1`), donc le
    // pipeline se termine honnêtement en refus plutôt qu'un candidat fabriqué,
    // quel que soit le nombre ou la qualité des observations de prix reçues.
    // Ce module ne produit lui-même aucun verdict BUY/REVIEW/PASS (voir le
    // test ci-dessous), mais cette structure garantit qu'aucun consommateur
    // en aval ne peut atteindre un tel verdict à partir d'un repli
    // `single_catalog_source` : il n'y a tout simplement pas de candidat.
    expect(result.stage).toBe("cross_match_refused");
    expect(result.candidate).toBeNull();
    expect(result.warnings.some((w) => w.includes("Pokémon TCG API") && w.includes("indisponible"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("plafonnée à 0.5"))).toBe(true);
    // Rien n'est persisté sans exact_match.
    expect(supabase.table("tcg_price_observations")).toHaveLength(0);
    expect(supabase.table("fx_rates")).toHaveLength(0);
  });

  it("Pokémon TCG API indisponible ET aucune carte TCGdex : refus propre, jamais un crash", async () => {
    const supabase = new FakeSupabase();
    const pokemonError = new Error("Pokémon TCG API a répondu 500 après 4 tentative(s).");
    const result = await orchestratePokemonPipeline({
      supabase: supabase as never,
      pokemonCatalogConnector: fakeFailingCatalogConnector("pokemon-tcg-api", pokemonError),
      tcgdexCatalogConnector: fakeCatalogConnector("tcgdex", []),
      justTcgPricingConnector: fakePricingConnector("justtcg", [justTcgObservation()]),
      tcgdexPricingConnector: fakePricingConnector("tcgdex", []),
      fxProvider: fakeFxProvider(fxRate()),
      categorySlug: CATEGORY_SLUG,
      hints: PIKACHU_HINTS,
      targetCurrency: "CHF",
    });

    expect(result.stage).toBe("catalog_no_match");
    expect(result.candidate).toBeNull();
    expect(result.reason).toContain("Pokémon TCG API");
    expect(result.reason).toContain("indisponible");
  });

  it("n'importe aucun symbole de @dealradar/core — aucune décision BUY/REVIEW/PASS possible depuis ce module", () => {
    const modulePath = fileURLToPath(new URL("../orchestrate-pokemon-pipeline.ts", import.meta.url));
    const source = readFileSync(modulePath, "utf-8");
    expect(source).not.toMatch(/from ["']@dealradar\/core["']/);
  });
});
