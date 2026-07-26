import { ConnectorError } from "../types";

export interface EbayOAuthConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export interface OAuthTokenProvider {
  /** Retourne un token valide, réutilisé depuis le cache mémoire tant qu'il n'est pas expiré. */
  getAccessToken(forceRefresh?: boolean): Promise<string>;
}

export function ebayApiHost(environment: EbayOAuthConfig["environment"]): string {
  return environment === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

/**
 * Fournisseur de token OAuth client credentials (eBay Identity API).
 * Le token est mis en cache mémoire (marge de 60s avant expiration réelle) —
 * jamais persisté, jamais journalisé. `fetchImpl` est injectable pour les tests.
 */
export function createOAuthTokenProvider(
  config: EbayOAuthConfig,
  fetchImpl: typeof fetch = fetch,
): OAuthTokenProvider {
  let cached: CachedToken | null = null;

  async function fetchNewToken(): Promise<CachedToken> {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    let response: Response;
    try {
      response = await fetchImpl(`${ebayApiHost(config.environment)}/identity/v1/oauth2/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "https://api.ebay.com/oauth/api_scope",
        }).toString(),
      });
    } catch (error) {
      throw new ConnectorError(
        `Impossible de joindre le service d'authentification eBay : ${error instanceof Error ? error.message : "erreur réseau"}`,
        { retryable: true },
      );
    }

    if (!response.ok) {
      throw new ConnectorError(`Authentification eBay refusée (HTTP ${response.status})`, {
        httpStatus: response.status,
        retryable: response.status >= 500,
      });
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    return {
      accessToken: body.access_token,
      expiresAtMs: Date.now() + body.expires_in * 1000 - 60_000,
    };
  }

  return {
    async getAccessToken(forceRefresh = false): Promise<string> {
      if (!forceRefresh && cached && cached.expiresAtMs > Date.now()) {
        return cached.accessToken;
      }
      cached = await fetchNewToken();
      return cached.accessToken;
    },
  };
}
