import { describe, expect, it, vi } from "vitest";
import { createEbayHttpClient } from "../client";
import { ConnectorError } from "../../types";
import type { OAuthTokenProvider } from "../oauth";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

function tokenProvider(...tokens: string[]): OAuthTokenProvider {
  const queue = [...tokens];
  return {
    getAccessToken: vi.fn(async () => queue.shift() ?? tokens[tokens.length - 1]!),
  };
}

const BASE_OPTIONS = { environment: "sandbox" as const, marketplaceId: "EBAY_CH" };

describe("createEbayHttpClient", () => {
  it("effectue un GET réussi et retourne le JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = createEbayHttpClient({ ...BASE_OPTIONS, tokenProvider: tokenProvider("tok"), fetchImpl });
    await expect(client.get("/buy/browse/v1/item_summary/search")).resolves.toEqual({ ok: true });
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createEbayHttpClient({
      ...BASE_OPTIONS,
      tokenProvider: tokenProvider("tok"),
      fetchImpl,
      timeoutMs: 20,
      maxRetries: 0,
    });

    await expect(client.get("/x")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("rafraîchit le token une fois sur 401 puis réussit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const provider = tokenProvider("old-token", "new-token");

    const client = createEbayHttpClient({ ...BASE_OPTIONS, tokenProvider: provider, fetchImpl });
    await expect(client.get("/x")).resolves.toEqual({ ok: true });
    expect(provider.getAccessToken).toHaveBeenCalledTimes(2);
    expect(provider.getAccessToken).toHaveBeenLastCalledWith(true);
  });

  it("échoue proprement si 401 persiste après rafraîchissement (pas de boucle infinie)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = createEbayHttpClient({
      ...BASE_OPTIONS,
      tokenProvider: tokenProvider("old-token", "new-token"),
      fetchImpl,
    });

    await expect(client.get("/x")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(401);
      expect((error as ConnectorError).retryable).toBe(false);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("respecte Retry-After sur 429 puis réussit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onRateLimitInfo = vi.fn();

    const client = createEbayHttpClient({
      ...BASE_OPTIONS,
      tokenProvider: tokenProvider("tok"),
      fetchImpl,
      onRateLimitInfo,
    });

    await expect(client.get("/x")).resolves.toEqual({ ok: true });
    expect(onRateLimitInfo).toHaveBeenCalledWith(expect.objectContaining({ "retry-after": "0" }));
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = createEbayHttpClient({ ...BASE_OPTIONS, tokenProvider: tokenProvider("tok"), fetchImpl });
    await expect(client.get("/x")).resolves.toEqual({ ok: true });
  });

  it("abandonne après le nombre maximal de tentatives sur 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const client = createEbayHttpClient({
      ...BASE_OPTIONS,
      tokenProvider: tokenProvider("tok"),
      fetchImpl,
      maxRetries: 0,
    });
    await expect(client.get("/x")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(500);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });

  it("ne réessaie jamais sur une 404 (erreur définitive)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const client = createEbayHttpClient({ ...BASE_OPTIONS, tokenProvider: tokenProvider("tok"), fetchImpl });
    await expect(client.get("/x")).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ne laisse jamais le token fuiter dans un message d'erreur", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    const client = createEbayHttpClient({
      ...BASE_OPTIONS,
      tokenProvider: tokenProvider("super-secret-token"),
      fetchImpl,
    });
    await expect(client.get("/x")).rejects.toSatisfy((error: unknown) => {
      expect((error as Error).message).not.toContain("super-secret-token");
      return true;
    });
  });
});
