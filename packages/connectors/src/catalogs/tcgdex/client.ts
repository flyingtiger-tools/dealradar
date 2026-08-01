import { ConnectorError } from "../../types";

export interface TcgdexClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface TcgdexHttpClient {
  /** `path` sans le préfixe de langue (ex. `/cards/base1-58`) — la langue est injectée ici, jamais codée en dur. */
  get(language: string, path: string, query?: Record<string, string | number | undefined>): Promise<unknown>;
}

const BASE_URL = "https://api.tcgdex.net/v2";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client HTTP TCGdex — gratuit, aucune clé API (confirmé par appel réel à
 * `api.tcgdex.net`, aucun en-tête d'authentification requis). Même
 * discipline timeout/retry+backoff que les autres clients : borné
 * strictement sur 429/5xx/erreurs réseau, jamais sur une 404 (carte/id
 * inexistant, réponse `{type, title, status, endpoint, method}` confirmée
 * par appel réel).
 */
export function createTcgdexHttpClient(options: TcgdexClientOptions = {}): TcgdexHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function requestOnce(language: string, path: string, query?: Record<string, string | number | undefined>): Promise<Response> {
    const url = new URL(`${BASE_URL}/${language}${path}`);
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

  async function get(language: string, path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(language, path, query);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(
            `Délai dépassé ou erreur réseau lors de l'appel TCGdex (${path}) après ${attempt + 1} tentative(s).`,
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
          throw new ConnectorError(`TCGdex a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`TCGdex a répondu ${response.status} (${path}).`, {
        httpStatus: response.status,
        retryable: false,
      });
    }
  }

  return { get };
}
