import { ConnectorError } from "../../types";

export interface TwitchOAuthConfig {
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export interface TwitchOAuthTokenProvider {
  getAccessToken(forceRefresh?: boolean): Promise<string>;
}

const TOKEN_ENDPOINT = "https://id.twitch.tv/oauth2/token";

/**
 * Fournisseur de token OAuth client credentials (Twitch Identity — IGDB
 * s'authentifie via l'écosystème développeur Twitch, confirmé par appel
 * réel ce lot : `POST id.twitch.tv/oauth2/token` avec des identifiants
 * invalides renvoie `{"status":400,"message":"invalid client"}`, jamais
 * un schéma deviné). MÊME discipline de cache mémoire que
 * `ebay/oauth.ts` (marge de 60s avant expiration réelle) — jamais
 * persisté, jamais journalisé.
 */
export function createTwitchOAuthTokenProvider(config: TwitchOAuthConfig, fetchImpl: typeof fetch = fetch): TwitchOAuthTokenProvider {
  let cached: CachedToken | null = null;

  async function fetchNewToken(): Promise<CachedToken> {
    const url = new URL(TOKEN_ENDPOINT);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("client_secret", config.clientSecret);
    url.searchParams.set("grant_type", "client_credentials");

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { method: "POST" });
    } catch (error) {
      throw new ConnectorError(`Impossible de joindre le service d'authentification Twitch/IGDB : ${error instanceof Error ? error.message : "erreur réseau"}`, { retryable: true });
    }

    if (!response.ok) {
      throw new ConnectorError(`Authentification Twitch/IGDB refusée (HTTP ${response.status})`, { httpStatus: response.status, retryable: response.status >= 500 });
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    return { accessToken: body.access_token, expiresAtMs: Date.now() + body.expires_in * 1000 - 60_000 };
  }

  return {
    async getAccessToken(forceRefresh = false): Promise<string> {
      if (!forceRefresh && cached && cached.expiresAtMs > Date.now()) return cached.accessToken;
      cached = await fetchNewToken();
      return cached.accessToken;
    },
  };
}
