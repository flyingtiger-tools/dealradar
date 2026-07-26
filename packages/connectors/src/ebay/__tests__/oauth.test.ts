import { describe, expect, it, vi } from "vitest";
import { createOAuthTokenProvider } from "../oauth";
import { ConnectorError } from "../../types";

const CONFIG = { clientId: "id", clientSecret: "topsecret-value", environment: "sandbox" as const };

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createOAuthTokenProvider", () => {
  it("récupère un token puis le met en cache sans refaire d'appel", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok-1", expires_in: 7200 }));
    const provider = createOAuthTokenProvider(CONFIG, fetchImpl);

    const first = await provider.getAccessToken();
    const second = await provider.getAccessToken();

    expect(first).toBe("tok-1");
    expect(second).toBe("tok-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rafraîchit le token quand forceRefresh est demandé", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok-1", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok-2", expires_in: 7200 }));
    const provider = createOAuthTokenProvider(CONFIG, fetchImpl);

    await provider.getAccessToken();
    const refreshed = await provider.getAccessToken(true);

    expect(refreshed).toBe("tok-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("lève une ConnectorError sans jamais exposer le client secret", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("invalid_client", { status: 401 }));
    const provider = createOAuthTokenProvider(CONFIG, fetchImpl);

    await expect(provider.getAccessToken()).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      const message = (error as ConnectorError).message;
      expect(message).not.toContain(CONFIG.clientSecret);
      expect((error as ConnectorError).httpStatus).toBe(401);
      return true;
    });
  });

  it("marque une erreur 5xx comme retryable, pas une 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    const provider = createOAuthTokenProvider(CONFIG, fetchImpl);

    await expect(provider.getAccessToken()).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).retryable).toBe(true);
      return true;
    });
  });
});
