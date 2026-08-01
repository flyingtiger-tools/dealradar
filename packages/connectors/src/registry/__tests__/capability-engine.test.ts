import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CatalogConnector, CatalogMatch, ConnectorDescriptor, HealthCheckResult } from "../../types";
import { createPokemonTcgCatalogConnector } from "../../catalogs/pokemon-tcg/connector";
import { createJustTcgPricingConnector } from "../../pricing/justtcg/connector";
import { PIKACHU_PROMO_CARD } from "../../catalogs/pokemon-tcg/__tests__/fixtures/cards";
import { PIKACHU_RAW_CARD } from "../../pricing/justtcg/__tests__/fixtures/cards";
import { ConnectorRegistry } from "../registry";
import { CapabilityEngine, rankCandidates, type HealthCheckedConnector } from "../capability-engine";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function health(status: HealthCheckResult["status"]): () => Promise<HealthCheckResult> {
  return async () => ({ status, checkedAt: new Date().toISOString(), latencyMs: 5 });
}

/** Catalog Connector jetable — jamais un connecteur réel dans les tests d'arbitrage pur du moteur. */
function fakeCatalogConnector(overrides: Partial<ConnectorDescriptor> & { resolveResult?: CatalogMatch[] } = {}): CatalogConnector {
  const { resolveResult = [], ...descriptorOverrides } = overrides;
  return {
    source: "fake-catalog",
    displayName: "Fake Catalog",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: ["pokemon_tcg"],
    declaredQuality: { reliability: 50, coverage: 50, freshness: 50, latency: 50, confidence: 50 },
    cost: { model: "free", details: "N/A" },
    quotas: {},
    license: { allowsCommercialUse: true, allowsCaching: true, maxCacheAgeHours: 24, allowsRedistribution: false, termsUrl: "https://example.test" },
    cachePolicy: { ttlHours: 24, staleWhileRevalidate: true },
    healthCheck: health("ok"),
    resolve: vi.fn().mockResolvedValue(resolveResult),
    getItem: vi.fn().mockResolvedValue(null),
    ...descriptorOverrides,
  };
}

describe("CapabilityEngine — arbitrage", () => {
  it("aucun candidat : retourne une liste vide sans erreur", async () => {
    const engine = new CapabilityEngine(new ConnectorRegistry());

    const result = await engine.resolveCatalog({ categorySlug: "pokemon_tcg", hints: {} });

    expect(result).toEqual([]);
  });

  it("un seul candidat : il est invoqué directement", async () => {
    const registry = new ConnectorRegistry();
    const sentinel: CatalogMatch[] = [{ item: { source: "fake-catalog", externalId: "x1", kind: "raw_card", categorySlug: "pokemon_tcg", name: "X", canonicalAttributes: {}, images: [], externalUrl: null }, confidence: 1, matchedOn: ["name"] }];
    const connector = fakeCatalogConnector({ resolveResult: sentinel });
    registry.register(connector);
    const engine = new CapabilityEngine(registry);

    const result = await engine.resolveCatalog({ categorySlug: "pokemon_tcg", hints: { name: "X" } });

    expect(result).toBe(sentinel);
    expect(connector.resolve).toHaveBeenCalledTimes(1);
  });

  it("connecteur unhealthy (down) : jamais invoqué, même seul candidat déclaré compatible", async () => {
    const registry = new ConnectorRegistry();
    const down = fakeCatalogConnector({ source: "down-connector", healthCheck: health("down") });
    registry.register(down);
    const engine = new CapabilityEngine(registry);

    const result = await engine.resolveCatalog({ categorySlug: "pokemon_tcg", hints: {} });

    expect(result).toEqual([]);
    expect(down.resolve).not.toHaveBeenCalled();
  });

  it("plusieurs candidats compatibles : le sain est choisi, le down est ignoré", async () => {
    const registry = new ConnectorRegistry();
    const down = fakeCatalogConnector({ source: "down-connector", healthCheck: health("down") });
    const healthy = fakeCatalogConnector({ source: "healthy-connector", healthCheck: health("ok"), resolveResult: [] });
    registry.register(down);
    registry.register(healthy);
    const engine = new CapabilityEngine(registry);

    await engine.resolveCatalog({ categorySlug: "pokemon_tcg", hints: {} });

    expect(down.resolve).not.toHaveBeenCalled();
    expect(healthy.resolve).toHaveBeenCalledTimes(1);
  });

  it("qualité déclarée vs observée : un connecteur dégradé perd face à un concurrent moins bien noté mais sain", async () => {
    const registry = new ConnectorRegistry();
    const highDeclaredButDegraded = fakeCatalogConnector({
      source: "high-declared-degraded",
      declaredQuality: { reliability: 90, coverage: 90, freshness: 90, latency: 90, confidence: 90 },
      healthCheck: health("degraded"),
    });
    const lowerDeclaredButHealthy = fakeCatalogConnector({
      source: "lower-declared-healthy",
      declaredQuality: { reliability: 60, coverage: 60, freshness: 60, latency: 60, confidence: 60 },
      healthCheck: health("ok"),
    });
    registry.register(highDeclaredButDegraded);
    registry.register(lowerDeclaredButHealthy);
    const engine = new CapabilityEngine(registry);

    await engine.resolveCatalog({ categorySlug: "pokemon_tcg", hints: {} });

    expect(lowerDeclaredButHealthy.resolve).toHaveBeenCalledTimes(1);
    expect(highDeclaredButDegraded.resolve).not.toHaveBeenCalled();
  });

  it("plusieurs candidats classés : rankCandidates ordonne par score décroissant, égalité tranchée par source", () => {
    const low: HealthCheckedConnector = {
      descriptor: fakeCatalogConnector({ source: "b-low", declaredQuality: { reliability: 20, coverage: 20, freshness: 20, latency: 20, confidence: 20 } }),
      health: { status: "ok", checkedAt: "now", latencyMs: 1 },
    };
    const highA: HealthCheckedConnector = {
      descriptor: fakeCatalogConnector({ source: "a-tie", declaredQuality: { reliability: 80, coverage: 80, freshness: 80, latency: 80, confidence: 80 } }),
      health: { status: "ok", checkedAt: "now", latencyMs: 1 },
    };
    const highB: HealthCheckedConnector = {
      descriptor: fakeCatalogConnector({ source: "b-tie", declaredQuality: { reliability: 80, coverage: 80, freshness: 80, latency: 80, confidence: 80 } }),
      health: { status: "ok", checkedAt: "now", latencyMs: 1 },
    };

    const ranked = rankCandidates([low, highB, highA]);

    expect(ranked.map((c) => c.source)).toEqual(["a-tie", "b-tie", "b-low"]);
  });
});

describe("CapabilityEngine — connecteur commercialement interdit", () => {
  it("exclu quand commercialUseRequired: true, disponible sinon", async () => {
    const registry = new ConnectorRegistry();
    const forbidden = fakeCatalogConnector({
      source: "forbidden",
      license: { allowsCommercialUse: false, allowsCaching: true, maxCacheAgeHours: 24, allowsRedistribution: false, termsUrl: "https://example.test" },
    });
    registry.register(forbidden);
    const engine = new CapabilityEngine(registry);

    const strict = await engine.resolveCatalog({ categorySlug: "pokemon_tcg", hints: {} }, undefined, { commercialUseRequired: true });
    expect(strict).toEqual([]);
    expect(forbidden.resolve).not.toHaveBeenCalled();

    const permissive = await engine.resolveCatalog({ categorySlug: "pokemon_tcg", hints: {} });
    expect(forbidden.resolve).toHaveBeenCalledTimes(1);
    void permissive;
  });
});

describe("CapabilityEngine — intégration avec les connecteurs réels", () => {
  it("catalog.resolve.v1 via le vrai connecteur Pokémon TCG API", async () => {
    const registry = new ConnectorRegistry();
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ data: [PIKACHU_PROMO_CARD] }));
    registry.register(createPokemonTcgCatalogConnector({ fetchImpl }));
    const engine = new CapabilityEngine(registry);

    const matches = await engine.resolveCatalog({
      categorySlug: "pokemon_tcg",
      hints: { name: "Pikachu", setName: "Wizards Black Star Promos", collectorNumber: "1" },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.item.externalId).toBe("basep-1");
    expect(matches[0]!.confidence).toBe(1);
  });

  it("pricing.lookup.v1 via le vrai connecteur JustTCG", async () => {
    const registry = new ConnectorRegistry();
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ data: [PIKACHU_RAW_CARD] }));
    registry.register(createJustTcgPricingConnector({ apiKey: "test-key", fetchImpl }));
    const engine = new CapabilityEngine(registry);

    const observations = await engine.resolvePricing({
      categorySlug: "pokemon_tcg",
      hints: { name: "Pikachu", setCode: "base4", collectorNumber: "58" },
    });

    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0]!.source).toBe("justtcg");
    expect(observations[0]!.setId).toBe("base4");
  });
});

describe("CapabilityEngine — aucun nom de connecteur en dur", () => {
  it("résout un connecteur totalement inventé, jamais référencé nulle part dans le moteur", async () => {
    const registry = new ConnectorRegistry();
    const sentinel: CatalogMatch[] = [
      { item: { source: "totally-invented-xyz", externalId: "z1", kind: "raw_card", categorySlug: "invented_category", canonicalAttributes: {}, images: [], externalUrl: null, name: "Z" }, confidence: 1, matchedOn: ["name"] },
    ];
    registry.register(
      fakeCatalogConnector({
        source: "totally-invented-xyz",
        supportedCategorySlugs: ["invented_category"],
        resolveResult: sentinel,
      }),
    );
    const engine = new CapabilityEngine(registry);

    const result = await engine.resolveCatalog({ categorySlug: "invented_category", hints: {} });

    expect(result).toBe(sentinel);
  });

  it("le code source du moteur ne contient aucun nom de connecteur connu (eBay/Pokémon/JustTCG)", () => {
    const engineSourcePath = fileURLToPath(new URL("../capability-engine.ts", import.meta.url));
    const source = readFileSync(engineSourcePath, "utf-8").toLowerCase();

    expect(source).not.toContain("ebay");
    expect(source).not.toContain("pokemon");
    expect(source).not.toContain("justtcg");
  });
});
