import { ConnectorError } from "../types";
import { signOAuth1Request, type OAuth1Credentials } from "./oauth1";

export interface BrickLinkClientOptions extends OAuth1Credentials {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface BrickLinkHttpClient {
  get(path: string, query?: Record<string, string | undefined>): Promise<unknown>;
}

const BASE_URL = "https://api.bricklink.com/api/store/v1";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client HTTP BrickLink — chaque requête est signée individuellement
 * (OAuth 1.0a, `oauth1.ts`), contrairement à eBay/OAuth2 (un jeton
 * d'accès unique réutilisable). Même discipline de retry/timeout que les
 * autres clients du paquet : borné strictement sur 429/5xx/erreurs
 * réseau, jamais de retry sur 400/401/403/404, jamais un secret dans un
 * message d'erreur.
 */
export function createBrickLinkHttpClient(options: BrickLinkClientOptions): BrickLinkHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  function buildUrl(path: string, query: Record<string, string | undefined>): { url: URL; queryParams: Record<string, string> } {
    const url = new URL(`${BASE_URL}${path}`);
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, value);
      queryParams[key] = value;
    }
    return { url, queryParams };
  }

  async function requestOnce(path: string, query: Record<string, string | undefined>): Promise<Response> {
    const { url, queryParams } = buildUrl(path, query);
    const authorization = signOAuth1Request(
      { consumerKey: options.consumerKey, consumerSecret: options.consumerSecret, token: options.token, tokenSecret: options.tokenSecret },
      { method: "GET", url: `${BASE_URL}${path}`, queryParams },
    );

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url.toString(), { method: "GET", headers: { Authorization: authorization }, signal: controller.signal });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  function backoffMs(attempt: number): number {
    return Math.min(300 * 2 ** attempt, 4000);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function get(path: string, query: Record<string, string | undefined> = {}): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(path, query);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel BrickLink (${path}) après ${attempt + 1} tentative(s).`, {
            retryable: true,
          });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`BrickLink a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`BrickLink a répondu ${response.status} (${path}).`, { httpStatus: response.status, retryable: false });
    }
  }

  return { get };
}
