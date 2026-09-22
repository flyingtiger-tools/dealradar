import { describe, expect, it, vi } from "vitest";
import { createOpenFoodFactsCatalogConnector, createOpenProductsFactsCatalogConnector } from "../connector";
import { NUTELLA_FOUND, NOT_FOUND, INVALID_CODE, FOUND_IN_SISTER_PROJECT } from "./fixtures/responses";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createOpenFoodFactsCatalogConnector", () => {
  it("descripteur : famille catalog, gratuit, aucune clé, licence ODbL avec attribution requise", () => {
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl: vi.fn() });
    expect(connector.family).toBe("catalog");
    expect(connector.source).toBe("open_food_facts");
    expect(connector.cost.model).toBe("free");
    expect(connector.license.allowsCommercialUse).toBe(true);
    expect(connector.license.allowsRedistribution).toBe(false); // jamais republier la base elle-même, seulement afficher un résultat de requête (Produced Work, pas Derivative Database)
  });

  it("resolve() sans barcode dans les hints : jamais d'appel réseau, tableau vide", async () => {
    const fetchImpl = vi.fn();
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: {} });
    expect(matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolve() avec un barcode trouvé : un match confiance 1", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(NUTELLA_FOUND));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: { barcode: "3017620422003" } });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.item.name).toBe("Nutella");
    expect(matches[0]!.confidence).toBe(1);
  });

  it("resolve() introuvable : tableau vide, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(NOT_FOUND));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: { barcode: "8710447452746" } });
    expect(matches).toEqual([]);
  });

  it("resolve() code invalide : tableau vide, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(INVALID_CODE));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: { barcode: "0000000000000" } });
    expect(matches).toEqual([]);
  });

  it("resolve() trouvé dans un projet frère (Open Beauty Facts) : jamais traité comme une correspondance", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(FOUND_IN_SISTER_PROJECT));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const matches = await connector.resolve({ categorySlug: "general", hints: { barcode: "3014230021404" } });
    expect(matches).toEqual([]);
  });

  it("getItem() trouvé : un CatalogItem", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(NUTELLA_FOUND));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const item = await connector.getItem("3017620422003");
    expect(item?.name).toBe("Nutella");
  });

  it("getItem() introuvable : null, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(NOT_FOUND));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const item = await connector.getItem("8710447452746");
    expect(item).toBeNull();
  });

  it("healthCheck() : ok quand le service répond, même pour un code-barres factice introuvable (200 + status 0 = service opérationnel)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "0000000000000", status: 0 }));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("healthCheck() : down sur une panne réseau/HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const connector = createOpenFoodFactsCatalogConnector({ fetchImpl, maxRetries: 0 });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});

describe("createOpenProductsFactsCatalogConnector", () => {
  it("source distincte, même contrat, même fabrique partagée — jamais une implémentation dupliquée qui pourrait diverger", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "3450970084468", status: 1, product: { product_name: "GEL WC" } }));
    const connector = createOpenProductsFactsCatalogConnector({ fetchImpl });
    expect(connector.source).toBe("open_products_facts");
    const matches = await connector.resolve({ categorySlug: "general", hints: { barcode: "3450970084468" } });
    expect(matches[0]!.item.source).toBe("open_products_facts");
    const [url] = fetchImpl.mock.calls[0]! as [string];
    expect(String(url)).toContain("world.openproductsfacts.org");
  });
});
