import { describe, expect, it, vi } from "vitest";
import { createRebrickableCatalogConnector } from "../connector";
import { DELOREAN_SET } from "./fixtures/sets";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createRebrickableCatalogConnector", () => {
  it("descripteur : famille catalog, catégorie lego uniquement, licence commerciale confirmée", () => {
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl: vi.fn() });
    expect(connector.family).toBe("catalog");
    expect(connector.supportedCategorySlugs).toEqual(["lego"]);
    expect(connector.license.allowsCommercialUse).toBe(true);
  });

  it("resolve() sans setNumber : jamais d'appel réseau, tableau vide", async () => {
    const fetchImpl = vi.fn();
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl });
    const matches = await connector.resolve({ categorySlug: "lego", hints: {} });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolve() avec setNumber SANS suffixe : normalisé en '-1' avant l'appel", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(DELOREAN_SET));
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl });
    await connector.resolve({ categorySlug: "lego", hints: { setNumber: "10300" } });
    const [url] = fetchImpl.mock.calls[0]! as [string];
    expect(String(url)).toContain("/lego/sets/10300-1/");
  });

  it("resolve() avec setNumber DÉJÀ suffixé : transmis tel quel, jamais doublé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(DELOREAN_SET));
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl });
    await connector.resolve({ categorySlug: "lego", hints: { setNumber: "10300-1" } });
    const [url] = fetchImpl.mock.calls[0]! as [string];
    expect(String(url)).toContain("/lego/sets/10300-1/");
    expect(String(url)).not.toContain("10300-1-1");
  });

  it("resolve() 404 : tableau vide, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl });
    const matches = await connector.resolve({ categorySlug: "lego", hints: { setNumber: "00000-1" } });
    expect(matches).toEqual([]);
  });

  it("getItem() trouvé : un CatalogItem", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(DELOREAN_SET));
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl });
    const item = await connector.getItem("10300-1");
    expect(item?.name).toBe("Back to the Future Time Machine");
  });

  it("getItem() introuvable : null, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl });
    const item = await connector.getItem("00000-1");
    expect(item).toBeNull();
  });

  it("healthCheck() : degraded (jamais down) sur une clé invalide — mauvaise config distincte d'une panne de service", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const connector = createRebrickableCatalogConnector({ apiKey: "bad", fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("degraded");
  });

  it("healthCheck() : ok quand le service répond avec succès", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(DELOREAN_SET));
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("healthCheck() : down sur une panne réseau/serveur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createRebrickableCatalogConnector({ apiKey: "k", fetchImpl, maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});
