import { describe, expect, it, vi } from "vitest";
import { createOpenPricesClient } from "../client";
import { ConnectorError } from "../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createOpenPricesClient", () => {
  it("filtre par product_code exact, aucune clé API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const client = createOpenPricesClient({ fetchImpl });
    await client.getPricesByBarcode("1541513213246", 5);
    const [url] = fetchImpl.mock.calls[0]! as [string];
    expect(String(url)).toContain("prices.openfoodfacts.org/api/v1/prices");
    expect(String(url)).toContain("product_code=1541513213246");
    expect(String(url)).toContain("page_size=5");
    expect(String(url)).not.toContain("api_key");
  });

  it("réessaie sur 500 puis réussit", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })).mockResolvedValueOnce(jsonResponse({ items: [] }));
    const client = createOpenPricesClient({ fetchImpl });
    await expect(client.getPricesByBarcode("x", 5)).resolves.toEqual({ items: [] });
  });

  it("abandonne après le nombre maximal de tentatives sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const client = createOpenPricesClient({ fetchImpl, maxRetries: 0 });
    await expect(client.getPricesByBarcode("x", 5)).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      return true;
    });
  });

  it("respecte un signal externe : abandon coopératif, jamais une panne fournisseur classée retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const client = createOpenPricesClient({ fetchImpl, timeoutMs: 5000 });
    const promise = client.getPricesByBarcode("x", 5, controller.signal);
    controller.abort();
    await expect(promise).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).aborted).toBe(true);
      expect((error as ConnectorError).retryable).toBe(false);
      return true;
    });
  });
});
