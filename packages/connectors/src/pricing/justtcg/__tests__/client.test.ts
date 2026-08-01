import { describe, expect, it, vi } from "vitest";
import { createJustTcgHttpClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("createJustTcgHttpClient", () => {
  it("effectue un GET réussi et retourne le JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = createJustTcgHttpClient({ apiKey: "test-key", fetchImpl });
    await expect(client.get("/cards")).resolves.toEqual({ data: [] });
  });

  it("envoie la clé API en en-tête x-api-key, jamais dans l'URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = createJustTcgHttpClient({ apiKey: "test-key", fetchImpl });
    await client.get("/cards", { q: "pikachu" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(String(url)).not.toContain("test-key");
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createJustTcgHttpClient({ apiKey: "test-key", fetchImpl, timeoutMs: 20, maxRetries: 0 });

    await expect(client.get("/cards")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("respecte Retry-After sur 429 puis réussit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const onRateLimitInfo = vi.fn();

    const client = createJustTcgHttpClient({ apiKey: "test-key", fetchImpl, onRateLimitInfo });

    await expect(client.get("/cards")).resolves.toEqual({ data: [] });
    expect(onRateLimitInfo).toHaveBeenCalledWith(expect.objectContaining({ "retry-after": "0" }));
  });

  it("abandonne après le nombre maximal de tentatives sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const client = createJustTcgHttpClient({ apiKey: "test-key", fetchImpl, maxRetries: 0 });
    await expect(client.get("/cards")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = createJustTcgHttpClient({ apiKey: "test-key", fetchImpl });
    await expect(client.get("/cards")).resolves.toEqual({ data: [] });
  });

  it("abandonne après le nombre maximal de tentatives sur 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const client = createJustTcgHttpClient({ apiKey: "test-key", fetchImpl, maxRetries: 0 });
    await expect(client.get("/cards")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(500);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("ne réessaie jamais sur une 404/401 (erreur définitive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = createJustTcgHttpClient({ apiKey: "bad-key", fetchImpl, maxRetries: 3 });
    await expect(client.get("/cards")).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ne laisse jamais la clé API fuiter dans un message d'erreur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const client = createJustTcgHttpClient({ apiKey: "super-secret-key", fetchImpl });
    await expect(client.get("/cards")).rejects.toSatisfy((error: unknown) => {
      expect((error as Error).message).not.toContain("super-secret-key");
      return true;
    });
  });
});
