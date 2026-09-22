import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { buildCatalogSourcesFromEnv, createCatalogLookup, createCatalogLookupCache, wrapCatalogLookupWithCache } from "../catalog-source-factory";
import type { CatalogConnector } from "@dealradar/connectors";

const ALL_ENV_KEYS = ["REBRICKABLE_API_KEY", "IGDB_CLIENT_ID", "IGDB_CLIENT_SECRET", "UPCDEV_API_KEY"] as const;

function clearAllEnv() {
  for (const key of ALL_ENV_KEYS) delete process.env[key];
}

describe("buildCatalogSourcesFromEnv", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ALL_ENV_KEYS) original[key] = process.env[key];
    clearAllEnv();
  });

  afterEach(() => {
    for (const key of ALL_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("Open Food Facts/Open Products Facts/Wikidata construits SANS aucune credential — gratuits/ouverts", () => {
    const result = buildCatalogSourcesFromEnv();
    expect(result.sources.has("open_food_facts")).toBe(true);
    expect(result.sources.has("open_products_facts")).toBe(true);
    expect(result.sources.has("wikidata")).toBe(true);
  });

  it("Rebrickable absent sans REBRICKABLE_API_KEY — diagnostic enabled:false, jamais une exception", () => {
    const result = buildCatalogSourcesFromEnv();
    expect(result.sources.has("rebrickable")).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.name === "rebrickable");
    expect(diagnostic?.enabled).toBe(false);
    expect(diagnostic?.readiness).toBe("missing_credentials");
  });

  it("Rebrickable construit dès que REBRICKABLE_API_KEY est présente", () => {
    process.env.REBRICKABLE_API_KEY = "test-key";
    const result = buildCatalogSourcesFromEnv();
    expect(result.sources.has("rebrickable")).toBe(true);
  });

  it("upc.dev absent sans UPCDEV_API_KEY — diagnostic enabled:false, jamais une exception (LOT 'Live Identity Enrichment...', section 3)", () => {
    const result = buildCatalogSourcesFromEnv();
    expect(result.sources.has("upcdev")).toBe(false);
    const diagnostic = result.diagnostics.find((d) => d.name === "upcdev");
    expect(diagnostic?.enabled).toBe(false);
    expect(diagnostic?.readiness).toBe("missing_credentials");
  });

  it("upc.dev construit dès que UPCDEV_API_KEY est présente", () => {
    process.env.UPCDEV_API_KEY = "test-key";
    const result = buildCatalogSourcesFromEnv();
    expect(result.sources.has("upcdev")).toBe(true);
  });

  it("IGDB JAMAIS construit, même avec les deux credentials posées — verrouillé par politique (productionAllowed=false)", () => {
    process.env.IGDB_CLIENT_ID = "cid";
    process.env.IGDB_CLIENT_SECRET = "secret";
    const result = buildCatalogSourcesFromEnv();
    expect(result.sources.has("igdb")).toBe(false);
    // Aucun diagnostic 'igdb' n'est même produit : cette fabrique ne tente
    // jamais de le construire, contrairement aux sources gérées ici.
    expect(result.diagnostics.find((d) => d.name === "igdb")).toBeUndefined();
  });

  it("les diagnostics ne portent QUE des noms/statuts, jamais une valeur de credential", () => {
    process.env.REBRICKABLE_API_KEY = "super-secret-key";
    const result = buildCatalogSourcesFromEnv();
    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).not.toContain("super-secret-key");
  });
});

describe("createCatalogLookup", () => {
  function fakeConnector(source: string, resolveFn: CatalogConnector["resolve"]): CatalogConnector {
    return {
      source,
      displayName: source,
      family: "catalog",
      capabilities: ["catalog.resolve.v1"],
      supportedCategorySlugs: "any",
      declaredQuality: { reliability: 50, coverage: 50, freshness: 50, latency: 50, confidence: 50 },
      cost: { model: "free", details: "" },
      quotas: {},
      license: { allowsCommercialUse: true, allowsCaching: true, maxCacheAgeHours: null, allowsRedistribution: false, termsUrl: "" },
      cachePolicy: { ttlHours: 24, staleWhileRevalidate: true },
      resolve: resolveFn,
      getItem: async () => null,
      healthCheck: async () => ({ status: "ok", checkedAt: "t", latencyMs: 1 }),
    };
  }

  it("open_food_facts : traduit hints.barcode -> { barcode } pour le connecteur, jamais un appel sans barcode", async () => {
    const resolveFn = vi.fn().mockResolvedValue([]);
    const sources = new Map([["open_food_facts", fakeConnector("open_food_facts", resolveFn)]]);
    const lookup = createCatalogLookup(sources);

    await lookup("open_food_facts", { barcode: "3017620422003" }, "general");
    expect(resolveFn).toHaveBeenCalledWith({ categorySlug: "general", hints: { barcode: "3017620422003" } });

    resolveFn.mockClear();
    await lookup("open_food_facts", {}, "general");
    expect(resolveFn).not.toHaveBeenCalled();
  });

  it("wikidata : traduit hints.barcode -> { gtin }, jamais { barcode } (vocabulaire propre au connecteur)", async () => {
    const resolveFn = vi.fn().mockResolvedValue([]);
    const sources = new Map([["wikidata", fakeConnector("wikidata", resolveFn)]]);
    const lookup = createCatalogLookup(sources);

    await lookup("wikidata", { barcode: "00640520098905" }, "apple");
    expect(resolveFn).toHaveBeenCalledWith({ categorySlug: "apple", hints: { gtin: "00640520098905" } });
  });

  it("rebrickable : traduit hints.legoSetNumber -> { setNumber }, jamais un appel sans numéro de set", async () => {
    const resolveFn = vi.fn().mockResolvedValue([]);
    const sources = new Map([["rebrickable", fakeConnector("rebrickable", resolveFn)]]);
    const lookup = createCatalogLookup(sources);

    await lookup("rebrickable", { legoSetNumber: "10300" }, "lego");
    expect(resolveFn).toHaveBeenCalledWith({ categorySlug: "lego", hints: { setNumber: "10300" } });

    resolveFn.mockClear();
    await lookup("rebrickable", {}, "lego");
    expect(resolveFn).not.toHaveBeenCalled();
  });

  it("upcdev : traduit hints.barcode -> { upc }, jamais un appel sans code-barres", async () => {
    const resolveFn = vi.fn().mockResolvedValue([]);
    const sources = new Map([["upcdev", fakeConnector("upcdev", resolveFn)]]);
    const lookup = createCatalogLookup(sources);

    await lookup("upcdev", { barcode: "0049000042566" }, "general");
    expect(resolveFn).toHaveBeenCalledWith({ categorySlug: "general", hints: { upc: "0049000042566" } });

    resolveFn.mockClear();
    await lookup("upcdev", {}, "general");
    expect(resolveFn).not.toHaveBeenCalled();
  });

  it("source non construite (absente de la map) : tableau vide, jamais une exception", async () => {
    const lookup = createCatalogLookup(new Map());
    await expect(lookup("rebrickable", { legoSetNumber: "10300" }, "lego")).resolves.toEqual([]);
  });
});

describe("wrapCatalogLookupWithCache (LOT 'Live Identity Enrichment + Barcode-First + upc.dev Fallback + Railway Readiness', section 11)", () => {
  function fakeConnector(source: string, ttlHours: number, allowsCaching = true): CatalogConnector {
    return {
      source,
      displayName: source,
      family: "catalog",
      capabilities: ["catalog.resolve.v1"],
      supportedCategorySlugs: "any",
      declaredQuality: { reliability: 50, coverage: 50, freshness: 50, latency: 50, confidence: 50 },
      cost: { model: "free", details: "" },
      quotas: {},
      license: { allowsCommercialUse: true, allowsCaching, maxCacheAgeHours: null, allowsRedistribution: false, termsUrl: "" },
      cachePolicy: { ttlHours, staleWhileRevalidate: true },
      resolve: async () => [],
      getItem: async () => null,
      healthCheck: async () => ({ status: "ok", checkedAt: "t", latencyMs: 1 }),
    };
  }

  it("un second appel pour le MÊME couple source+identifiant réutilise le cache — jamais un second appel réseau", async () => {
    const underlying = vi.fn().mockResolvedValue([{ item: { source: "wikidata", externalId: "Q1", kind: "x", categorySlug: "general", name: "x", canonicalAttributes: {}, images: [], externalUrl: null }, confidence: 1, matchedOn: ["barcode"] }]);
    const sources = new Map([["wikidata", fakeConnector("wikidata", 168)]]);
    const cached = wrapCatalogLookupWithCache(underlying, sources, createCatalogLookupCache());

    await cached("wikidata", { barcode: "123" }, "general");
    await cached("wikidata", { barcode: "123" }, "general");

    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("un identifiant DIFFÉRENT n'est jamais confondu avec un autre déjà en cache", async () => {
    const underlying = vi.fn().mockResolvedValue([]);
    const sources = new Map([["wikidata", fakeConnector("wikidata", 168)]]);
    const cached = wrapCatalogLookupWithCache(underlying, sources, createCatalogLookupCache());

    await cached("wikidata", { barcode: "111" }, "general");
    await cached("wikidata", { barcode: "222" }, "general");

    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("un résultat NÉGATIF (aucun match) est aussi mis en cache — jamais un second appel réseau pour un 'non trouvé' déjà connu", async () => {
    const underlying = vi.fn().mockResolvedValue([]);
    const sources = new Map([["open_food_facts", fakeConnector("open_food_facts", 24)]]);
    const cached = wrapCatalogLookupWithCache(underlying, sources, createCatalogLookupCache());

    await cached("open_food_facts", { barcode: "000" }, "general");
    await cached("open_food_facts", { barcode: "000" }, "general");

    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("un connecteur avec allowsCaching:false n'est JAMAIS mis en cache", async () => {
    const underlying = vi.fn().mockResolvedValue([]);
    const sources = new Map([["x", fakeConnector("x", 24, false)]]);
    const cached = wrapCatalogLookupWithCache(underlying, sources, createCatalogLookupCache());

    await cached("x", { barcode: "1" }, "general");
    await cached("x", { barcode: "1" }, "general");

    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("une PANNE (exception) n'est jamais mise en cache — l'appel suivant réessaie normalement", async () => {
    const underlying = vi.fn().mockRejectedValueOnce(new Error("panne simulée")).mockResolvedValueOnce([]);
    const sources = new Map([["wikidata", fakeConnector("wikidata", 168)]]);
    const cached = wrapCatalogLookupWithCache(underlying, sources, createCatalogLookupCache());

    await expect(cached("wikidata", { barcode: "1" }, "general")).rejects.toThrow("panne simulée");
    await expect(cached("wikidata", { barcode: "1" }, "general")).resolves.toEqual([]);
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("expiration du TTL : un appel après expiration réinterroge réellement la source", async () => {
    const underlying = vi.fn().mockResolvedValue([]);
    const sources = new Map([["wikidata", fakeConnector("wikidata", 168)]]);
    const cache = createCatalogLookupCache();
    const cached = wrapCatalogLookupWithCache(underlying, sources, cache);

    const realNow = Date.now;
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      await cached("wikidata", { barcode: "1" }, "general");
      now += 25 * 3_600_000; // 25h plus tard : dépasse le TTL négatif plafonné à 24h, même pour un connecteur au TTL positif de 168h
      await cached("wikidata", { barcode: "1" }, "general");
    } finally {
      Date.now = realNow;
    }

    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("taille bornée : au-delà de la capacité, l'entrée la plus ancienne est évincée (jamais une croissance mémoire illimitée)", async () => {
    const underlying = vi.fn().mockResolvedValue([]);
    const sources = new Map([["wikidata", fakeConnector("wikidata", 168)]]);
    const cache = createCatalogLookupCache();
    const cached = wrapCatalogLookupWithCache(underlying, sources, cache);

    for (let i = 0; i < 2001; i += 1) {
      await cached("wikidata", { barcode: `barcode-${i}` }, "general");
    }

    expect(cache.size).toBeLessThanOrEqual(2000);
  });
});
