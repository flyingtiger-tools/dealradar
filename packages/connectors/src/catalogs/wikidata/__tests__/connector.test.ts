import { describe, expect, it, vi } from "vitest";
import { createWikidataCatalogConnector } from "../connector";
import { IPHONE_7_GTIN_RESULT, EMPTY_RESULT } from "./fixtures/results";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createWikidataCatalogConnector", () => {
  it("descripteur : famille catalog, couverture 'any', licence CC0, aucune restriction commerciale", () => {
    const connector = createWikidataCatalogConnector({ fetchImpl: vi.fn() });
    expect(connector.family).toBe("catalog");
    expect(connector.supportedCategorySlugs).toBe("any");
    expect(connector.license.allowsCommercialUse).toBe(true);
    expect(connector.cost.model).toBe("free");
  });

  it("resolve() sans gtin : jamais d'appel réseau, tableau vide", async () => {
    const fetchImpl = vi.fn();
    const connector = createWikidataCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "apple", hints: {} });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolve() avec un gtin réel trouvé : un match confiance 1", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(IPHONE_7_GTIN_RESULT));
    const connector = createWikidataCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "apple", hints: { gtin: "00640520098905" } });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.item.name).toBe("Apple iPhone 7 128GB Jet Black");
  });

  it("resolve() gtin introuvable : tableau vide, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(EMPTY_RESULT));
    const connector = createWikidataCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: { gtin: "0000000000000" } });
    expect(matches).toEqual([]);
  });

  it("getItem() : jamais implémenté ce lot (hors scope), retourne null sans jamais lancer une exception", async () => {
    const connector = createWikidataCatalogConnector({ fetchImpl: vi.fn() });
    await expect(connector.getItem("Q29972750")).resolves.toBeNull();
  });

  it("healthCheck() : ok quand le service répond", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(IPHONE_7_GTIN_RESULT));
    const connector = createWikidataCatalogConnector({ fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("healthCheck() : down sur une panne réseau/serveur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createWikidataCatalogConnector({ fetchImpl, maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});
