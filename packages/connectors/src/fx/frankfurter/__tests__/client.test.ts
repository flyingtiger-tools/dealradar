import { describe, expect, it, vi } from "vitest";
import { createFrankfurterHttpClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createFrankfurterHttpClient", () => {
  it("effectue un GET réussi et retourne le JSON, sans aucune clé API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ date: "2026-07-31", base: "USD", quote: "CHF", rate: 0.9 }]));
    const client = createFrankfurterHttpClient({ fetchImpl });
    await expect(client.get("/rates", { base: "USD", quotes: "CHF" })).resolves.toEqual([
      { date: "2026-07-31", base: "USD", quote: "CHF", rate: 0.9 },
    ]);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain("app_id");
    expect(String(url)).not.toContain("api_key");
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createFrankfurterHttpClient({ fetchImpl, timeoutMs: 20, maxRetries: 0 });

    await expect(client.get("/rates")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse([{ date: "2026-07-31", base: "USD", quote: "CHF", rate: 0.9 }]));
    const client = createFrankfurterHttpClient({ fetchImpl });
    await expect(client.get("/rates")).resolves.toHaveLength(1);
  });

  it("abandonne après le nombre maximal de tentatives sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const client = createFrankfurterHttpClient({ fetchImpl, maxRetries: 0 });
    await expect(client.get("/rates")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("ne réessaie jamais sur une 404 (devise/date invalide)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const client = createFrankfurterHttpClient({ fetchImpl, maxRetries: 3 });
    await expect(client.get("/rates")).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
