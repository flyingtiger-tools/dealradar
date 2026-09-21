import { ConnectorError } from "../types";

export interface SerpApiClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  onRateLimitInfo?: (headers: Record<string, string>) => void;
}

export interface SerpApiHttpClient {
  get(query: Record<string, string | number | undefined>): Promise<unknown>;
}

const BASE_URL = "https://serpapi.com/search.json";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client HTTP SerpApi — même discipline que les autres clients du paquet
 * (eBay, JustTCG, Pokémon TCG API) : timeout, retry+backoff borné
 * strictement sur 429/5xx/erreurs réseau, respect de `Retry-After`, jamais
 * de retry sur 400/401/403/404. La clé API est un paramètre de requête
 * (convention SerpApi, pas un en-tête) — jamais loggée, jamais incluse
 * dans un message d'erreur (voir `requestOnce`, qui ne journalise que le
 * chemin/statut, jamais l'URL complète avec la clé).
 */
export function createSerpApiClient(options: SerpApiClientOptions): SerpApiHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  function buildUrl(query: Record<string, string | number | undefined>): URL {
    const url = new URL(BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    url.searchParams.set("api_key", options.apiKey);
    return url;
  }

  async function requestOnce(query: Record<string, string | number | undefined>): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(buildUrl(query).toString(), { method: "GET", signal: controller.signal });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  function reportRateLimitHeaders(response: Response): void {
    if (!options.onRateLimitInfo) return;
    const info: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "retry-after" || lower.startsWith("x-ratelimit")) info[lower] = value;
    });
    if (Object.keys(info).length > 0) options.onRateLimitInfo(info);
  }

  function retryAfterMs(response: Response): number | null {
    const header = response.headers.get("retry-after");
    if (!header) return null;
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) return seconds * 1000;
    const dateMs = Date.parse(header);
    return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
  }

  function backoffMs(attempt: number): number {
    return Math.min(300 * 2 ** attempt, 4000);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function get(query: Record<string, string | number | undefined>): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(query);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel SerpApi après ${attempt + 1} tentative(s).`, {
            retryable: true,
          });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      reportRateLimitHeaders(response);

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`SerpApi a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(retryAfterMs(response) ?? backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`SerpApi a répondu ${response.status}.`, { httpStatus: response.status, retryable: false });
    }
  }

  return { get };
}
