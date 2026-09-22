import { describe, expect, it, vi } from "vitest";
import { createUpcDevClient } from "../client";
import { ConnectorError } from "../../../types";
import { COCA_COLA_RESPONSE, WARMING_503_TEXT } from "./fixtures";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

describe("createUpcDevClient", () => {
  it("envoie la clé via l'en-tête X-API-Key, jamais en query string", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COCA_COLA_RESPONSE));
    const client = createUpcDevClient({ fetchImpl, apiKey: "secret-key" });
    await client.getProduct("049000042566");
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toBe("https://upc.dev/v1/product/049000042566");
    expect(String(url)).not.toContain("secret-key");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("secret-key");
  });

  it("200 : renvoie le JSON parsé tel quel", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(COCA_COLA_RESPONSE));
    const client = createUpcDevClient({ fetchImpl, apiKey: "k" });
    await expect(client.getProduct("049000042566")).resolves.toEqual(COCA_COLA_RESPONSE);
  });

  it("404 (aucun produit, y compris un format invalide en pratique) : jamais réessayé, ConnectorError httpStatus 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: "Invalid UPC pattern", code: "INVALID_UPC" }, 404));
    const client = createUpcDevClient({ fetchImpl, apiKey: "k", maxRetries: 3 });
    await expect(client.getProduct("000000000000")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).httpStatus).toBe(404);
      expect((error as ConnectorError).retryable).toBe(false);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("401 (clé invalide/absente) : jamais réessayé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = createUpcDevClient({ fetchImpl, apiKey: "bad-key", maxRetries: 3 });
    await expect(client.getProduct("049000042566")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(401);
      expect((error as ConnectorError).retryable).toBe(false);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("503 'warming' à corps TEXTE BRUT (démarrage à froid réel observé ce lot) : jamais un crash de parsing JSON, réessayé comme un 5xx ordinaire", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(textResponse(WARMING_503_TEXT, 503)).mockResolvedValueOnce(jsonResponse(COCA_COLA_RESPONSE));
    const client = createUpcDevClient({ fetchImpl, apiKey: "k" });
    await expect(client.getProduct("049000042566")).resolves.toEqual(COCA_COLA_RESPONSE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("503 persistant au-delà des tentatives : ConnectorError retryable, jamais une boucle infinie", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(WARMING_503_TEXT, 503));
    const client = createUpcDevClient({ fetchImpl, apiKey: "k", maxRetries: 1 });
    await expect(client.getProduct("049000042566")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const client = createUpcDevClient({ fetchImpl, apiKey: "k", timeoutMs: 20, maxRetries: 0 });
    await expect(client.getProduct("049000042566")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });
});
