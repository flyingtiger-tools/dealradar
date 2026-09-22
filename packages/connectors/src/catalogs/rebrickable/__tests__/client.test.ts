import { describe, expect, it, vi } from "vitest";
import { createRebrickableClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createRebrickableClient", () => {
  it("envoie la clé via l'en-tête Authorization: key <clé>, jamais en query string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ set_num: "10300-1" }));
    const client = createRebrickableClient({ fetchImpl, apiKey: "secret-key" });
    await client.getSet("10300-1");
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toBe("https://rebrickable.com/api/v3/lego/sets/10300-1/");
    expect(String(url)).not.toContain("secret-key");
    expect((init.headers as Record<string, string>).Authorization).toBe("key secret-key");
  });

  it("401 (clé invalide/absente) : jamais réessayé, ConnectorError httpStatus 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = createRebrickableClient({ fetchImpl, apiKey: "bad-key", maxRetries: 3 });
    await expect(client.getSet("10300-1")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).httpStatus).toBe(401);
      expect((error as ConnectorError).retryable).toBe(false);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("404 (set inconnu) : jamais réessayé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const client = createRebrickableClient({ fetchImpl, apiKey: "k", maxRetries: 3 });
    await expect(client.getSet("00000-1")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(404);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })).mockResolvedValueOnce(jsonResponse({ set_num: "10300-1" }));
    const client = createRebrickableClient({ fetchImpl, apiKey: "k" });
    await expect(client.getSet("10300-1")).resolves.toEqual({ set_num: "10300-1" });
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createRebrickableClient({ fetchImpl, apiKey: "k", timeoutMs: 20, maxRetries: 0 });
    await expect(client.getSet("10300-1")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });
});
