import { ConnectorError } from "../../types";

export interface FrankfurterClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface FrankfurterHttpClient {
  get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown>;
}

const BASE_URL = "https://api.frankfurter.dev/v2";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client HTTP Frankfurter — gratuit, aucune clé API (voir frankfurter.dev :
 * "It requires no API key"). Même discipline timeout/retry+backoff que les
 * autres clients du paquet : retry borné strictement sur 429/5xx/erreurs
 * réseau, jamais sur une erreur 4xx définitive (devise/date invalide).
 */
export function createFrankfurterHttpClient(options: FrankfurterClientOptions = {}): FrankfurterHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function requestOnce(path: string, query?: Record<string, string | number | undefined>): Promise<Response> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url.toString(), { method: "GET", signal: controller.signal });
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

  async function get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(path, query);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(
            `Délai dépassé ou erreur réseau lors de l'appel Frankfurter (${path}) après ${attempt + 1} tentative(s).`,
            { retryable: true },
          );
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Frankfurter a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`Frankfurter a répondu ${response.status} (${path}).`, {
        httpStatus: response.status,
        retryable: false,
      });
    }
  }

  return { get };
}
