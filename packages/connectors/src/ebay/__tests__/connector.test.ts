import { describe, expect, it, vi } from "vitest";
import { createEbayConnector } from "../connector";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: "tok", expires_in: 7200 });
}

const CONFIG = {
  clientId: "id",
  clientSecret: "secret",
  marketplaceId: "EBAY_CH",
  environment: "sandbox" as const,
};

describe("createEbayConnector", () => {
  it("ne déclare jamais soldPrices, stock ou publish", () => {
    const connector = createEbayConnector({ ...CONFIG, fetchImpl: vi.fn() });
    expect(connector.capabilities).toEqual(["search", "itemDetails"]);
    expect(connector.capabilities).not.toContain("soldPrices");
    expect(connector.capabilities).not.toContain("stock");
    expect(connector.capabilities).not.toContain("publish");
  });

  it("recherche, normalise, et calcule hasMore à partir du total", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          total: 3,
          itemSummaries: [
            { itemId: "1", title: "Item 1", price: { value: "10.00", currency: "CHF" } },
            { itemId: "2", title: "Item 2", price: { value: "20.00", currency: "CHF" } },
          ],
        }),
      );
    const connector = createEbayConnector({ ...CONFIG, fetchImpl });

    const result = await connector.search({ q: "lego", categorySlug: "lego", limit: 2, offset: 0 });

    expect(result.listings).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.listings[0]!.categorySlug).toBe("lego");
  });

  it("indique hasMore = false quand la page couvre tout le total", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          total: 1,
          itemSummaries: [{ itemId: "1", title: "Item 1", price: { value: "10.00", currency: "CHF" } }],
        }),
      );
    const connector = createEbayConnector({ ...CONFIG, fetchImpl });
    const result = await connector.search({ q: "lego", categorySlug: "lego", limit: 50, offset: 0 });
    expect(result.hasMore).toBe(false);
  });

  it("filtre silencieusement les items non normalisables d'une page sans faire échouer toute la recherche", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          total: 2,
          itemSummaries: [
            { itemId: "1", title: "Item valide", price: { value: "10.00", currency: "CHF" } },
            { itemId: "2", title: "Item sans prix" },
          ],
        }),
      );
    const connector = createEbayConnector({ ...CONFIG, fetchImpl });
    const result = await connector.search({ q: "lego", categorySlug: "lego" });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.meta.externalId).toBe("1");
  });

  it("getItem() exige un categorySlug explicite et l'applique au résultat", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        jsonResponse({ itemId: "1", title: "Item détaillé", price: { value: "10.00", currency: "CHF" } }),
      );
    const connector = createEbayConnector({ ...CONFIG, fetchImpl });
    const item = await connector.getItem("1", "apple");
    expect(item?.categorySlug).toBe("apple");
  });

  it("healthCheck() rapporte 'down' proprement quand l'authentification échoue (ex. identifiants absents/invalides)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("invalid_client", { status: 401 }));
    const connector = createEbayConnector({ ...CONFIG, fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
    expect(health.message).not.toContain(CONFIG.clientSecret);
  });

  it("healthCheck() rapporte 'ok' quand l'authentification réussit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tokenResponse());
    const connector = createEbayConnector({ ...CONFIG, fetchImpl });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
    expect(health.latencyMs).not.toBeNull();
  });
});
