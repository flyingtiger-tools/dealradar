import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry, ProviderError } from "../http";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("fetchWithRetry", () => {
  it("retourne le JSON parsé sur un succès", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const result = await fetchWithRetry("https://api.example.com", {}, { fetchImpl });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("relance sur 429 puis réussit, en respectant un nombre de tentatives borné", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(429, {}, { "retry-after": "0" });
      return jsonResponse(200, { ok: true });
    });
    const result = await fetchWithRetry("https://api.example.com", {}, { fetchImpl, maxRetries: 2 });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("relance sur une erreur 5xx", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(503, {});
      return jsonResponse(200, { ok: true });
    });
    const result = await fetchWithRetry("https://api.example.com", {}, { fetchImpl, maxRetries: 2 });
    expect(result).toEqual({ ok: true });
  });

  it("ne relance jamais sur 401/403 — échec immédiat", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, {}));
    await expect(fetchWithRetry("https://api.example.com", {}, { fetchImpl, maxRetries: 3 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("échoue après épuisement des tentatives sur des erreurs 5xx répétées", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    await expect(fetchWithRetry("https://api.example.com", {}, { fetchImpl, maxRetries: 1 })).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("convertit un timeout (AbortError) en ProviderError TIMEOUT après épuisement des tentatives", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(fetchWithRetry("https://api.example.com", {}, { fetchImpl, maxRetries: 0 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });

  it("ne journalise/n'expose jamais le header Authorization dans une erreur", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, {}));
    try {
      await fetchWithRetry(
        "https://api.example.com",
        { headers: { Authorization: "Bearer super-secret-token" } },
        { fetchImpl },
      );
      throw new Error("devrait avoir levé");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("super-secret-token");
    }
  });
});
