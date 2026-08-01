import { describe, expect, it, vi } from "vitest";
import { createPokemonTcgHttpClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("createPokemonTcgHttpClient", () => {
  it("effectue un GET réussi et retourne le JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = createPokemonTcgHttpClient({ fetchImpl });
    await expect(client.get("/cards")).resolves.toEqual({ data: [] });
  });

  it("envoie la clé API en en-tête X-Api-Key quand fournie, jamais sinon", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = createPokemonTcgHttpClient({ fetchImpl, apiKey: "test-key" });
    await client.get("/cards");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
  });

  it("n'envoie aucun en-tête X-Api-Key sans clé configurée", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    const client = createPokemonTcgHttpClient({ fetchImpl });
    await client.get("/cards");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBeUndefined();
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createPokemonTcgHttpClient({ fetchImpl, timeoutMs: 20, maxRetries: 0 });

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

    const client = createPokemonTcgHttpClient({ fetchImpl, onRateLimitInfo });

    await expect(client.get("/cards")).resolves.toEqual({ data: [] });
    expect(onRateLimitInfo).toHaveBeenCalledWith(expect.objectContaining({ "retry-after": "0" }));
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const client = createPokemonTcgHttpClient({ fetchImpl });
    await expect(client.get("/cards")).resolves.toEqual({ data: [] });
  });

  it("abandonne après le nombre maximal de tentatives sur 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const client = createPokemonTcgHttpClient({ fetchImpl, maxRetries: 0 });
    await expect(client.get("/cards")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(500);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("ne réessaie jamais sur une 404 (erreur définitive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const client = createPokemonTcgHttpClient({ fetchImpl });
    await expect(client.get("/cards/unknown")).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ne réessaie jamais sur une 400/403 (erreur définitive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    const client = createPokemonTcgHttpClient({ fetchImpl, maxRetries: 3 });
    await expect(client.get("/cards")).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
