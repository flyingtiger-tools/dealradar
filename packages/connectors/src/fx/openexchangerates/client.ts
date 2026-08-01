import { ConnectorError } from "../../types";

export interface OpenExchangeRatesClientOptions {
  appId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface OpenExchangeRatesHttpClient {
  get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown>;
}

const BASE_URL = "https://openexchangerates.org/api";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client HTTP Open Exchange Rates : timeout, retry+backoff borné strictement
 * sur 429/5xx/erreurs réseau, jamais de retry sur 400/401/403/404 (voir
 * https://docs.openexchangerates.org/reference/errors — `invalid_app_id`,
 * `invalid_base`, `not_found` ne sont jamais transitoires). `app_id` est un
 * paramètre de requête documenté par l'API elle-même, jamais un en-tête —
 * même discipline que les autres clients connecteurs du paquet.
 */
export function createOpenExchangeRatesHttpClient(options: OpenExchangeRatesClientOptions): OpenExchangeRatesHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function requestOnce(path: string, query?: Record<string, string | number | undefined>): Promise<Response> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("app_id", options.appId);
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
            `Délai dépassé ou erreur réseau lors de l'appel Open Exchange Rates (${path}) après ${attempt + 1} tentative(s).`,
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
          throw new ConnectorError(`Open Exchange Rates a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      const body = await response.json().catch(() => null);
      const description = body && typeof body === "object" && "description" in body ? String((body as { description: unknown }).description) : null;
      throw new ConnectorError(`Open Exchange Rates a répondu ${response.status} (${path})${description ? ` : ${description}` : ""}.`, {
        httpStatus: response.status,
        retryable: false,
      });
    }
  }

  return { get };
}
