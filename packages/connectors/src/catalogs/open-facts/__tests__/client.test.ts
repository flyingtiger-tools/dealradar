import { describe, expect, it, vi } from "vitest";
import { createOpenFactsHttpClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createOpenFactsHttpClient", () => {
  it("effectue un GET réussi, sans aucune clé API, avec un User-Agent explicite", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "3017620422003", status: 1, product: { product_name: "Nutella" } }));
    const client = createOpenFactsHttpClient({ fetchImpl, baseUrl: "https://world.openfoodfacts.org" });
    await expect(client.getProductByBarcode("3017620422003", ["code", "status", "product_name"])).resolves.toEqual({
      code: "3017620422003",
      status: 1,
      product: { product_name: "Nutella" },
    });
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain("world.openfoodfacts.org/api/v2/product/3017620422003.json");
    expect(String(url)).toContain("fields=code%2Cstatus%2Cproduct_name");
    expect(String(url)).not.toContain("api_key");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/DealRadar/);
  });

  it("sert Open Products Facts via le même client, base URL distincte", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "3450970084468", status: 1 }));
    const client = createOpenFactsHttpClient({ fetchImpl, baseUrl: "https://world.openproductsfacts.org" });
    await client.getProductByBarcode("3450970084468", ["code"]);
    const [url] = fetchImpl.mock.calls[0]! as [string];
    expect(String(url)).toContain("world.openproductsfacts.org/api/v2/product/3450970084468.json");
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createOpenFactsHttpClient({ fetchImpl, baseUrl: "https://world.openfoodfacts.org", timeoutMs: 20, maxRetries: 0 });
    await expect(client.getProductByBarcode("3017620422003", ["code"])).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })).mockResolvedValueOnce(jsonResponse({ code: "x", status: 0 }));
    const client = createOpenFactsHttpClient({ fetchImpl, baseUrl: "https://world.openfoodfacts.org" });
    await expect(client.getProductByBarcode("x", ["code"])).resolves.toEqual({ code: "x", status: 0 });
  });

  it("abandonne après le nombre maximal de tentatives sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const client = createOpenFactsHttpClient({ fetchImpl, baseUrl: "https://world.openfoodfacts.org", maxRetries: 0 });
    await expect(client.getProductByBarcode("x", ["code"])).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("ne réessaie jamais sur une 403 (jamais confondu avec 429/5xx)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const client = createOpenFactsHttpClient({ fetchImpl, baseUrl: "https://world.openfoodfacts.org", maxRetries: 3 });
    await expect(client.getProductByBarcode("x", ["code"])).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
