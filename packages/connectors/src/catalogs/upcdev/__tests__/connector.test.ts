import { describe, expect, it, vi } from "vitest";
import { createUpcDevCatalogConnector } from "../connector";
import { COCA_COLA_RESPONSE } from "./fixtures";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createUpcDevCatalogConnector", () => {
  it("descripteur : famille catalog, toute catégorie, licence commerciale confirmée, cache agressif (30 jours)", () => {
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl: vi.fn() });
    expect(connector.family).toBe("catalog");
    expect(connector.supportedCategorySlugs).toBe("any");
    expect(connector.license.allowsCommercialUse).toBe(true);
    expect(connector.license.allowsCaching).toBe(true);
    expect(connector.cachePolicy.ttlHours).toBe(720);
  });

  it("resolve() sans upc : jamais d'appel réseau, tableau vide", async () => {
    const fetchImpl = vi.fn();
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: {} });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolve() avec upc trouvé : un CatalogMatch confiance 1", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COCA_COLA_RESPONSE));
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: { upc: "049000042566" } });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBe(1);
    expect(matches[0]!.item.name).toBe("Coca-Cola Zero Sugar");
  });

  it("resolve() 404 : tableau vide, jamais une exception (couvre aussi le cas réel 'format invalide' -> 404)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "Invalid UPC pattern", code: "INVALID_UPC" }, 404));
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: { upc: "000000000000" } });
    expect(matches).toEqual([]);
  });

  it("resolve() panne réseau/serveur persistante : propage une exception (jamais un tableau vide silencieux qui masquerait une vraie panne) — isolée par l'appelant (enrichProductIdentity)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl, maxRetries: 0 });
    await expect(connector.resolve({ categorySlug: "general", hints: { upc: "049000042566" } })).rejects.toThrow();
  });

  it("getItem() trouvé : un CatalogItem", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COCA_COLA_RESPONSE));
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl });
    const item = await connector.getItem("049000042566");
    expect(item?.name).toBe("Coca-Cola Zero Sugar");
  });

  it("getItem() introuvable : null, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "not found", code: "INVALID_UPC" }, 404));
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl });
    const item = await connector.getItem("000000000000");
    expect(item).toBeNull();
  });

  it("healthCheck() : degraded (jamais down) sur une clé invalide — mauvaise config distincte d'une panne de service", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const connector = createUpcDevCatalogConnector({ apiKey: "bad", fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("degraded");
  });

  it("healthCheck() : ok quand le service répond avec succès", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COCA_COLA_RESPONSE));
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("healthCheck() : down sur une panne réseau/serveur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createUpcDevCatalogConnector({ apiKey: "k", fetchImpl, maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});
