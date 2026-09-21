import { describe, expect, it, vi } from "vitest";
import { createBrickLinkConnector } from "../connector";

function fakeFetch(handler: (url: string) => { status: number; body: unknown }): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const CREDENTIALS = { consumerKey: "ck", consumerSecret: "cs", token: "tk", tokenSecret: "ts" };

function soldResponse(newOrUsed: "N" | "U") {
  return {
    data: { item: { no: "75192", type: "SET" }, new_or_used: newOrUsed, currency_code: "CHF", avg_price: "800.00", qty_avg_price: "790.00" },
  };
}

function stockResponse(newOrUsed: "N" | "U") {
  return {
    data: { item: { no: "75192", type: "SET" }, new_or_used: newOrUsed, currency_code: "CHF", avg_price: "850.00" },
  };
}

describe("createBrickLinkConnector", () => {
  it("déclare historicalPrices/activeListings, jamais soldTransactions", () => {
    const connector = createBrickLinkConnector({ ...CREDENTIALS, fetchImpl: fakeFetch(() => ({ status: 404, body: {} })) });
    expect(connector.evidenceTypes).toContain("historicalPrices");
    expect(connector.evidenceTypes).toContain("activeListings");
    expect(connector.evidenceTypes).not.toContain("soldTransactions");
    expect(connector.supportedCategorySlugs).toEqual(["lego"]);
  });

  it("sans hints.bricklinkNo : résultat vide, jamais une exception, jamais une supposition de numéro de set", async () => {
    const connector = createBrickLinkConnector({ ...CREDENTIALS, fetchImpl: fakeFetch(() => ({ status: 404, body: {} })) });
    const result = await connector.search({ categorySlug: "lego", q: "millennium falcon" });
    expect(result.observations).toEqual([]);
  });

  it("avec hints.bricklinkNo : interroge les 4 combinaisons (sold/stock x new/used) et normalise chaque réponse exploitable", async () => {
    const fetchImpl = fakeFetch((url) => {
      const isSold = url.includes("guide_type=sold");
      const isNew = url.includes("new_or_used=N");
      return { status: 200, body: isSold ? soldResponse(isNew ? "N" : "U") : stockResponse(isNew ? "N" : "U") };
    });
    const connector = createBrickLinkConnector({ ...CREDENTIALS, fetchImpl });

    const result = await connector.search({ categorySlug: "lego", q: "75192", hints: { bricklinkNo: "75192" } });

    expect(result.observations).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const tiers = result.observations.map((o) => o.evidenceTier).sort();
    expect(tiers).toEqual(["B", "B", "D", "D"]);
  });

  it("une combinaison en 404 (aucune donnée pour cet état) est ignorée, jamais bloquante pour les autres", async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("new_or_used=U")) return { status: 404, body: { meta: { code: 404 } } };
      const isSold = url.includes("guide_type=sold");
      return { status: 200, body: isSold ? soldResponse("N") : stockResponse("N") };
    });
    const connector = createBrickLinkConnector({ ...CREDENTIALS, fetchImpl });

    const result = await connector.search({ categorySlug: "lego", q: "75192", hints: { bricklinkNo: "75192" } });

    expect(result.observations).toHaveLength(2); // seulement les 2 combinaisons "N"
  });

  it("healthCheck() : ok sur succès", async () => {
    const connector = createBrickLinkConnector({ ...CREDENTIALS, fetchImpl: fakeFetch(() => ({ status: 200, body: stockResponse("N") })) });
    const health = await connector.healthCheck();
    expect(health.status).toBe("ok");
  });

  it("healthCheck() : down sur échec, jamais les secrets OAuth dans le message", async () => {
    const connector = createBrickLinkConnector({ ...CREDENTIALS, consumerSecret: "super-secret", fetchImpl: fakeFetch(() => ({ status: 401, body: {} })) });
    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
    expect(health.message).not.toContain("super-secret");
  });

  it("respecte le type d'article personnalisé via hints.bricklinkType", async () => {
    const fetchImpl = fakeFetch((url) => ({ status: 200, body: url.includes("guide_type=sold") ? soldResponse("N") : stockResponse("N") }));
    const connector = createBrickLinkConnector({ ...CREDENTIALS, fetchImpl });

    await connector.search({ categorySlug: "lego", q: "3001", hints: { bricklinkNo: "3001", bricklinkType: "PART" } });

    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("/items/PART/3001/price");
  });
});
