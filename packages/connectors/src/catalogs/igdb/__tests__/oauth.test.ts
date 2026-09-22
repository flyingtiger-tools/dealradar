import { describe, expect, it, vi } from "vitest";
import { createTwitchOAuthTokenProvider } from "../oauth";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createTwitchOAuthTokenProvider", () => {
  it("récupère un token via client_credentials, jamais un secret journalisé/exposé dans l'URL retournée à l'appelant", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok-123", expires_in: 3600 }));
    const provider = createTwitchOAuthTokenProvider({ clientId: "id", clientSecret: "secret" }, fetchImpl);
    const token = await provider.getAccessToken();
    expect(token).toBe("tok-123");
    const [url] = fetchImpl.mock.calls[0]! as [string];
    expect(String(url)).toContain("id.twitch.tv/oauth2/token");
    expect(String(url)).toContain("grant_type=client_credentials");
  });

  it("met le token en cache — un second appel avant expiration ne refait pas de requête réseau", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok-123", expires_in: 3600 }));
    const provider = createTwitchOAuthTokenProvider({ clientId: "id", clientSecret: "secret" }, fetchImpl);
    await provider.getAccessToken();
    await provider.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("forceRefresh ignore le cache et redemande un token", async () => {
    // `mockImplementation` (jamais `mockResolvedValue` seul) — chaque appel
    // doit renvoyer un `Response` FRAIS : le corps d'un `Response` ne peut
    // être lu (`.json()`) qu'une seule fois, réutiliser la même instance
    // ferait échouer le second appel avec "Body has already been read".
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ access_token: "tok-123", expires_in: 3600 })));
    const provider = createTwitchOAuthTokenProvider({ clientId: "id", clientSecret: "secret" }, fetchImpl);
    await provider.getAccessToken();
    await provider.getAccessToken(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("identifiants invalides (400) : ConnectorError, jamais un token fabriqué", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 400, message: "invalid client" }, 400));
    const provider = createTwitchOAuthTokenProvider({ clientId: "bad", clientSecret: "bad" }, fetchImpl);
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(ConnectorError);
  });
});
