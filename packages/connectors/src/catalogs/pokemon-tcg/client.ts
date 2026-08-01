import { ConnectorError } from "../../types";

export interface PokemonTcgClientOptions {
  /** Optionnelle mais recommandée par l'API (relève le quota de 1 000/jour à 20 000/jour). */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Reçoit les en-têtes de rate-limit bruts quand présents — jamais de secret. */
  onRateLimitInfo?: (headers: Record<string, string>) => void;
}

export interface PokemonTcgHttpClient {
  get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown>;
}

const BASE_URL = "https://api.pokemontcg.io/v2";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client HTTP Pokémon TCG API : timeout, retry+backoff borné strictement sur
 * 429/5xx/erreurs réseau, respect de `Retry-After`, jamais de retry sur
 * 400/401/403/404. Même discipline que `packages/connectors/src/ebay/client.ts`
 * — pas d'OAuth ici, juste une clé API optionnelle en en-tête.
 */
export function createPokemonTcgHttpClient(options: PokemonTcgClientOptions = {}): PokemonTcgHttpClient {
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
      const headers: Record<string, string> = {};
      if (options.apiKey) headers["X-Api-Key"] = options.apiKey;
      return await fetchImpl(url.toString(), { method: "GET", headers, signal: controller.signal });
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

  async function get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(path, query);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(
            `Délai dépassé ou erreur réseau lors de l'appel Pokémon TCG API (${path}) après ${attempt + 1} tentative(s).`,
            { retryable: true },
          );
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      reportRateLimitHeaders(response);

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Pokémon TCG API a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(retryAfterMs(response) ?? backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`Pokémon TCG API a répondu ${response.status} (${path}).`, {
        httpStatus: response.status,
        retryable: false,
      });
    }
  }

  return { get };
}
