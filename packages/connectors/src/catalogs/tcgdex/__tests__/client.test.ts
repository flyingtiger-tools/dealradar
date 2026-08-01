import { describe, expect, it, vi } from "vitest";
import { createTcgdexHttpClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createTcgdexHttpClient", () => {
  it("effectue un GET réussi, sans aucune clé API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: "base1-58", localId: "58", name: "Pikachu" }]));
    const client = createTcgdexHttpClient({ fetchImpl });
    await expect(client.get("en", "/cards", { name: "eq:Pikachu" })).resolves.toEqual([
      { id: "base1-58", localId: "58", name: "Pikachu" },
    ]);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/v2/en/cards");
    expect(String(url)).not.toContain("app_id");
    expect(String(url)).not.toContain("api_key");
  });

  it("injecte la langue dans le chemin de la requête, jamais codée en dur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = createTcgdexHttpClient({ fetchImpl });
    await client.get("fr", "/cards", { name: "eq:Pikachu" });
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/v2/fr/cards");
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createTcgdexHttpClient({ fetchImpl, timeoutMs: 20, maxRetries: 0 });

    await expect(client.get("en", "/cards")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })).mockResolvedValueOnce(jsonResponse([]));
    const client = createTcgdexHttpClient({ fetchImpl });
    await expect(client.get("en", "/cards")).resolves.toEqual([]);
  });

  it("abandonne après le nombre maximal de tentatives sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const client = createTcgdexHttpClient({ fetchImpl, maxRetries: 0 });
    await expect(client.get("en", "/cards")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("ne réessaie jamais sur une 404 (forme d'erreur TCGdex confirmée par appel réel)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "https://tcgdex.dev/errors/not-found", title: "not found", status: 404 }), { status: 404 }),
    );
    const client = createTcgdexHttpClient({ fetchImpl, maxRetries: 3 });
    await expect(client.get("en", "/cards/unknown-id")).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
