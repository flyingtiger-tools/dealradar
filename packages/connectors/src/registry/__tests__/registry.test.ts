import { describe, expect, it } from "vitest";
import type { ConnectorDescriptor, HealthCheckResult } from "../../types";
import { ConnectorRegistry } from "../registry";
import { DuplicateConnectorError } from "../types";

function fakeHealth(status: HealthCheckResult["status"] = "ok"): () => Promise<HealthCheckResult> {
  return async () => ({ status, checkedAt: new Date().toISOString(), latencyMs: 10 });
}

/** Descripteur minimal conforme au socle ADR 0012 — jamais un connecteur réel dans ces tests de registre pur. */
function fakeDescriptor(overrides: Partial<ConnectorDescriptor> = {}): ConnectorDescriptor {
  return {
    source: "fake-source",
    displayName: "Fake Connector",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: ["pokemon_tcg"],
    declaredQuality: { reliability: 50, coverage: 50, freshness: 50, latency: 50, confidence: 50 },
    cost: { model: "free", details: "N/A" },
    quotas: {},
    license: { allowsCommercialUse: true, allowsCaching: true, maxCacheAgeHours: 24, allowsRedistribution: false, termsUrl: "https://example.test" },
    cachePolicy: { ttlHours: 24, staleWhileRevalidate: true },
    healthCheck: fakeHealth(),
    ...overrides,
  };
}

describe("ConnectorRegistry", () => {
  it("enregistre un connecteur", () => {
    const registry = new ConnectorRegistry();
    const connector = fakeDescriptor();

    registry.register(connector);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("fake-source")).toBe(connector);
  });

  it("refuse un doublon (même source déjà enregistrée)", () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeDescriptor());

    expect(() => registry.register(fakeDescriptor())).toThrow(DuplicateConnectorError);
    expect(registry.list()).toHaveLength(1);
  });

  it("recherche par famille", () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeDescriptor({ source: "catalog-a", family: "catalog" }));
    registry.register(fakeDescriptor({ source: "pricing-a", family: "pricing", capabilities: ["pricing.lookup.v1"] }));

    const catalogOnly = registry.query({ family: "catalog" });

    expect(catalogOnly.map((c) => c.source)).toEqual(["catalog-a"]);
  });

  it("recherche par capacité versionnée", () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeDescriptor({ source: "resolve-v1", capabilities: ["catalog.resolve.v1"] }));
    registry.register(fakeDescriptor({ source: "resolve-v2", capabilities: ["catalog.resolve.v2"] }));

    const v1Only = registry.query({ capability: "catalog.resolve.v1" });

    expect(v1Only.map((c) => c.source)).toEqual(["resolve-v1"]);
  });

  it("filtre par catégorie supportée / non supportée", () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeDescriptor({ source: "pokemon-only", supportedCategorySlugs: ["pokemon_tcg"] }));
    registry.register(fakeDescriptor({ source: "any-category", supportedCategorySlugs: "any" }));
    registry.register(fakeDescriptor({ source: "lego-only", supportedCategorySlugs: ["lego"] }));

    const forPokemon = registry.query({ categorySlug: "pokemon_tcg" });

    expect(forPokemon.map((c) => c.source).sort()).toEqual(["any-category", "pokemon-only"]);
  });

  it("filtre un connecteur commercialement interdit", () => {
    const registry = new ConnectorRegistry();
    registry.register(fakeDescriptor({ source: "forbidden", license: { allowsCommercialUse: false, allowsCaching: true, maxCacheAgeHours: 24, allowsRedistribution: false, termsUrl: "https://example.test" } }));
    registry.register(fakeDescriptor({ source: "allowed", license: { allowsCommercialUse: true, allowsCaching: true, maxCacheAgeHours: 24, allowsRedistribution: false, termsUrl: "https://example.test" } }));

    const commercial = registry.query({ commercialUseRequired: true });

    expect(commercial.map((c) => c.source)).toEqual(["allowed"]);
  });
});
