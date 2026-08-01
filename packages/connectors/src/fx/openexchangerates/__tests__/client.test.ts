import { describe, expect, it, vi } from "vitest";
import { createOpenExchangeRatesHttpClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createOpenExchangeRatesHttpClient", () => {
  it("effectue un GET réussi et retourne le JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ base: "USD", timestamp: 1785500000, rates: { CHF: 0.91 } }));
    const client = createOpenExchangeRatesHttpClient({ appId: "test-app-id", fetchImpl });
    await expect(client.get("/latest.json", { base: "USD", symbols: "CHF" })).resolves.toEqual({
      base: "USD",
      timestamp: 1785500000,
      rates: { CHF: 0.91 },
    });
  });

  it("envoie app_id en paramètre de requête (seul mécanisme documenté par l'API)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ base: "USD", timestamp: 1, rates: {} }));
    const client = createOpenExchangeRatesHttpClient({ appId: "test-app-id", fetchImpl });
    await client.get("/latest.json");
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("app_id=test-app-id");
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createOpenExchangeRatesHttpClient({ appId: "test-app-id", fetchImpl, timeoutMs: 20, maxRetries: 0 });

    await expect(client.get("/latest.json")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ base: "USD", timestamp: 1, rates: { CHF: 0.91 } }));
    const client = createOpenExchangeRatesHttpClient({ appId: "test-app-id", fetchImpl });
    await expect(client.get("/latest.json")).resolves.toMatchObject({ base: "USD" });
  });

  it("abandonne après le nombre maximal de tentatives sur 429 (not_allowed)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: true, status: 429, message: "not_allowed" }), { status: 429 }),
    );
    const client = createOpenExchangeRatesHttpClient({ appId: "test-app-id", fetchImpl, maxRetries: 0 });
    await expect(client.get("/latest.json")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("ne réessaie jamais sur une 401 invalid_app_id (erreur définitive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: true, status: 401, message: "invalid_app_id", description: "Invalid App ID provided." }), {
        status: 401,
      }),
    );
    const client = createOpenExchangeRatesHttpClient({ appId: "bad-app-id", fetchImpl, maxRetries: 3 });
    await expect(client.get("/latest.json")).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ne laisse jamais l'app_id fuiter dans un message d'erreur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: true, status: 401, message: "invalid_app_id" }), { status: 401 }),
    );
    const client = createOpenExchangeRatesHttpClient({ appId: "super-secret-app-id", fetchImpl });
    await expect(client.get("/latest.json")).rejects.toSatisfy((error: unknown) => {
      expect((error as Error).message).not.toContain("super-secret-app-id");
      return true;
    });
  });
});
