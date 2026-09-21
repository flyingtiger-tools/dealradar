import { describe, expect, it, vi } from "vitest";
import { createKeepaConnector } from "../connector";
import { KeepaCsvType } from "../raw-types";

function fakeFetch(responses: { status: number; body: unknown }[]): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    const { status, body } = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("createKeepaConnector", () => {
  it("déclare retailPrices/historicalPrices/barcodeLookup, jamais soldTransactions", () => {
    const connector = createKeepaConnector({ apiKey: "test-key", fetchImpl: fakeFetch([{ status: 200, body: {} }]) });
    expect(connector.evidenceTypes).toContain("retailPrices");
    expect(connector.evidenceTypes).toContain("historicalPrices");
    expect(connector.evidenceTypes).not.toContain("soldTransactions");
    expect(connector.supportedCategorySlugs).toEqual(["gaming", "apple", "pc_components"]);
  });

  it("sans hints.asin ni hints.upc/ean : résultat vide, jamais une recherche floue devinée", async () => {
    const connector = createKeepaConnector({ apiKey: "test-key", fetchImpl: fakeFetch([{ status: 200, body: {} }]) });
    const result = await connector.search({ categorySlug: "gaming", q: "nintendo switch" });
    expect(result.observations).toEqual([]);
  });

  it("avec hints.asin : interroge par ASIN et normalise le produit", async () => {
    const csv: number[][] = [];
    csv[KeepaCsvType.AMAZON] = [0, 34999];
    const fetchImpl = fakeFetch([{ status: 200, body: { products: [{ asin: "B00005N5PF", title: "Switch OLED", domainId: 1, csv }] } }]);
    const connector = createKeepaConnector({ apiKey: "test-key", fetchImpl });

    const result = await connector.search({ categorySlug: "gaming", q: "switch oled", hints: { asin: "B00005N5PF" } });

    expect(result.observations).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("asin=B00005N5PF");
    expect(calledUrl).toContain("key=test-key");
  });

  it("avec hints.upc : interroge via le paramètre 'code'", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { products: [] } }]);
    const connector = createKeepaConnector({ apiKey: "test-key", fetchImpl });

    await connector.search({ categorySlug: "gaming", q: "x", hints: { upc: "045496883254" } });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("code=045496883254");
  });

  it("recherche PAR IDENTIFIANT D'ABORD (LOT 'Source Wave 3', section 8) : avec hints.ean (ex. iPhone), interroge via 'code', jamais par texte libre même si q est renseigné", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { products: [] } }]);
    const connector = createKeepaConnector({ apiKey: "test-key", fetchImpl });

    await connector.search({ categorySlug: "apple", q: "iphone 13 128gb bleu presque neuf", hints: { ean: "0194252707326" } });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("code=0194252707326");
    expect(calledUrl).not.toContain("iphone");
  });

  it("query.country résout le domaine Keepa correspondant", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { products: [] } }]);
    const connector = createKeepaConnector({ apiKey: "test-key", fetchImpl });

    await connector.search({ categorySlug: "gaming", q: "x", hints: { asin: "B00005N5PF" }, country: "de" });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("domain=3");
  });

  it("pays non reconnu -> domaine par défaut (US), jamais une erreur", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { products: [] } }]);
    const connector = createKeepaConnector({ apiKey: "test-key", fetchImpl });

    await connector.search({ categorySlug: "gaming", q: "x", hints: { asin: "B00005N5PF" }, country: "ch" });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("domain=1");
  });

  it("erreur explicite dans la réponse (clé invalide/quota) : lève une ConnectorError, jamais un résultat vide silencieux", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { error: "Invalid access token." } }]);
    const connector = createKeepaConnector({ apiKey: "bad-key", fetchImpl });

    await expect(connector.search({ categorySlug: "gaming", q: "x", hints: { asin: "B00005N5PF" } })).rejects.toThrow(/Invalid access token/);
  });

  it("healthCheck() : down sur échec, jamais la clé dans le message", async () => {
    const fetchImpl = fakeFetch([{ status: 401, body: {} }]);
    const connector = createKeepaConnector({ apiKey: "super-secret-key", fetchImpl });

    const health = await connector.healthCheck();

    expect(health.status).toBe("down");
    expect(health.message).not.toContain("super-secret-key");
  });
});
