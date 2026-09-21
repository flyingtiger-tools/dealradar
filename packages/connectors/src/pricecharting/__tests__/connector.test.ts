import { describe, expect, it, vi } from "vitest";
import { createPriceChartingConnector } from "../connector";

function fakeFetch(responses: { status: number; body: unknown }[]): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    const { status, body } = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("createPriceChartingConnector", () => {
  it("déclare historicalPrices/barcodeLookup/search, jamais soldTransactions", () => {
    const connector = createPriceChartingConnector({ token: "test-token", fetchImpl: fakeFetch([{ status: 200, body: {} }]) });
    expect(connector.evidenceTypes).toContain("historicalPrices");
    expect(connector.evidenceTypes).not.toContain("soldTransactions");
    expect(connector.supportedCategorySlugs).toEqual(["gaming", "collectibles"]);
  });

  it("sans hints.priceChartingId ni hints.upc : résultat vide, jamais une recherche floue devinée", async () => {
    const connector = createPriceChartingConnector({ token: "test-token", fetchImpl: fakeFetch([{ status: 200, body: {} }]) });
    const result = await connector.search({ categorySlug: "gaming", q: "super mario 64" });
    expect(result.observations).toEqual([]);
  });

  it("avec hints.priceChartingId : interroge par id et normalise le produit", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { id: "6910", "product-name": "Super Mario 64", "loose-price": 2500 } }]);
    const connector = createPriceChartingConnector({ token: "test-token", fetchImpl });

    const result = await connector.search({ categorySlug: "gaming", q: "super mario 64", hints: { priceChartingId: "6910" } });

    expect(result.observations).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("id=6910");
    expect(calledUrl).toContain("t=test-token");
  });

  it("avec hints.upc : interroge par code-barres", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { id: "6910", "loose-price": 2500 } }]);
    const connector = createPriceChartingConnector({ token: "test-token", fetchImpl });

    await connector.search({ categorySlug: "gaming", q: "x", hints: { upc: "045496830434" } });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("upc=045496830434");
  });

  it("statut d'erreur explicite dans la réponse : lève une ConnectorError, jamais un résultat vide silencieux", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { status: "error", "error-message": "invalid token" } }]);
    const connector = createPriceChartingConnector({ token: "bad-token", fetchImpl });

    await expect(connector.search({ categorySlug: "gaming", q: "x", hints: { priceChartingId: "6910" } })).rejects.toThrow(/invalid token/);
  });

  it("healthCheck() : down sur échec, jamais le token dans le message", async () => {
    const fetchImpl = fakeFetch([{ status: 401, body: {} }]);
    const connector = createPriceChartingConnector({ token: "super-secret-token", fetchImpl });

    const health = await connector.healthCheck();

    expect(health.status).toBe("down");
    expect(health.message).not.toContain("super-secret-token");
  });
});
