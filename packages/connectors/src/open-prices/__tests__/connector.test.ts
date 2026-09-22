import { describe, expect, it, vi } from "vitest";
import { createOpenPricesConnector } from "../connector";
import { ELEFAN_PRICE_OBSERVATIONS, EMPTY_RESPONSE } from "./fixtures/responses";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createOpenPricesConnector", () => {
  it("déclare UNIQUEMENT retailPrices — jamais 'search' (aucune recherche floue fiable côté Open Prices)", () => {
    const source = createOpenPricesConnector({ fetchImpl: vi.fn() });
    expect(source.evidenceTypes).toEqual(["retailPrices"]);
    expect(source.sourceKind).toBe("aggregator");
  });

  it("search() sans barcode dans les hints : jamais d'appel réseau, aucune observation", async () => {
    const fetchImpl = vi.fn();
    const source = createOpenPricesConnector({ fetchImpl });
    const result = await source.search({ categorySlug: "general", q: "x", hints: {} });
    expect(result.observations).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("search() avec un barcode réel : observations retailPrices, jamais soldTransactions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(ELEFAN_PRICE_OBSERVATIONS));
    const source = createOpenPricesConnector({ fetchImpl });
    const result = await source.search({ categorySlug: "general", q: "1541513213246", hints: { barcode: "1541513213246" } });
    expect(result.observations).toHaveLength(2);
    expect(result.observations.every((o) => o.evidenceType === "retailPrices")).toBe(true);
    expect(result.hasMore).toBe(true); // total=3, 2 retournées
  });

  it("search() aucun résultat : tableau vide, jamais une exception", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(EMPTY_RESPONSE));
    const source = createOpenPricesConnector({ fetchImpl });
    const result = await source.search({ categorySlug: "general", q: "x", hints: { barcode: "0000000000000" } });
    expect(result.observations).toEqual([]);
  });

  it("healthCheck() : ok quand le service répond", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(ELEFAN_PRICE_OBSERVATIONS));
    const source = createOpenPricesConnector({ fetchImpl });
    const health = await source.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("healthCheck() : down sur une panne réseau/serveur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const source = createOpenPricesConnector({ fetchImpl, maxRetries: 0 });
    const health = await source.healthCheck();
    expect(health.status).toBe("down");
  });
});
