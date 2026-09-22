import { describe, expect, it, vi } from "vitest";
import { createIgdbClient } from "../client";
import { ConnectorError } from "../../../types";
import type { TwitchOAuthTokenProvider } from "../oauth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeTokenProvider(token = "tok-123"): TwitchOAuthTokenProvider {
  return { getAccessToken: vi.fn().mockResolvedValue(token) };
}

describe("createIgdbClient", () => {
  it("envoie Client-ID + Authorization: Bearer <token>, corps en syntaxe Apicalypse (texte)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const tokenProvider = fakeTokenProvider();
    const client = createIgdbClient({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider });
    await client.post("/games", "fields id,name; limit 1;");
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toBe("https://api.igdb.com/v4/games");
    expect((init.headers as Record<string, string>)["Client-ID"]).toBe("cid");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    expect(init.body).toBe("fields id,name; limit 1;");
  });

  it("401 : rafraîchit le token UNE SEULE fois puis réessaie, jamais une boucle infinie", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("unauthorized", { status: 401 })).mockResolvedValueOnce(jsonResponse([]));
    const tokenProvider = fakeTokenProvider();
    const client = createIgdbClient({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider });
    await expect(client.post("/games", "fields id;")).resolves.toEqual([]);
    expect(tokenProvider.getAccessToken).toHaveBeenCalledWith(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("réessaie sur 500 puis réussit, dans la limite de tentatives", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 500 })).mockResolvedValueOnce(jsonResponse([]));
    const client = createIgdbClient({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider() });
    await expect(client.post("/games", "fields id;")).resolves.toEqual([]);
  });

  it("abandonne après le nombre maximal de tentatives sur 429", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const client = createIgdbClient({ clientId: "cid", clientSecret: "secret", fetchImpl, tokenProvider: fakeTokenProvider(), maxRetries: 0 });
    await expect(client.post("/games", "fields id;")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      return true;
    });
  });
});
