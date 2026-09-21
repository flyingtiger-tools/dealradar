import { describe, expect, it, vi } from "vitest";
import { createGoogleShoppingConnector } from "../connector";

function fakeFetch(responses: { status: number; body: unknown }[]): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    const { status, body } = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("createGoogleShoppingConnector", () => {
  it("déclare retailPrices/activeListings/search, jamais soldTransactions", () => {
    const connector = createGoogleShoppingConnector({ apiKey: "test-key", fetchImpl: fakeFetch([{ status: 200, body: {} }]) });
    expect(connector.evidenceTypes).toContain("retailPrices");
    expect(connector.evidenceTypes).toContain("activeListings");
    expect(connector.evidenceTypes).not.toContain("soldTransactions");
    expect(connector.supportedCategorySlugs).toBe("any");
  });

  it("search() normalise les résultats et transmet le pays par défaut", async () => {
    const fetchImpl = fakeFetch([
      { status: 200, body: { shopping_results: [{ title: "Item A", product_id: "1", extracted_price: 100, source: "Shop" }] } },
    ]);
    const connector = createGoogleShoppingConnector({ apiKey: "test-key", fetchImpl });

    const result = await connector.search({ categorySlug: "gaming", q: "item a" });

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.currency).toBe("CHF"); // défaut "ch"
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("gl=ch");
    expect(calledUrl).toContain("api_key=test-key");
  });

  it("respecte un pays explicite dans la requête, jamais le défaut silencieusement", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { shopping_results: [] } }]);
    const connector = createGoogleShoppingConnector({ apiKey: "test-key", fetchImpl });

    await connector.search({ categorySlug: "gaming", q: "item a", country: "us" });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("gl=us");
  });

  it("réponse SerpApi en erreur (`error` non-null) : lève une ConnectorError explicite, jamais un résultat vide silencieux", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { error: "Invalid API key." } }]);
    const connector = createGoogleShoppingConnector({ apiKey: "bad-key", fetchImpl });

    await expect(connector.search({ categorySlug: "gaming", q: "item a" })).rejects.toThrow(/Invalid API key/);
  });

  it("healthCheck() : ok avec latence sur succès", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { shopping_results: [] } }]);
    const connector = createGoogleShoppingConnector({ apiKey: "test-key", fetchImpl });

    const health = await connector.healthCheck();

    expect(health.status).toBe("ok");
    expect(health.latencyMs).not.toBeNull();
  });

  it("healthCheck() : down sur échec, jamais la clé API dans le message", async () => {
    const fetchImpl = fakeFetch([{ status: 401, body: { error: "Unauthorized" } }]);
    const connector = createGoogleShoppingConnector({ apiKey: "super-secret-key", fetchImpl });

    const health = await connector.healthCheck();

    expect(health.status).toBe("down");
    expect(health.message).not.toContain("super-secret-key");
  });
});
