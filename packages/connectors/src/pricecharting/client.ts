import { ConnectorError } from "../types";
import { createBoundedAbortController } from "../http-abort";

export interface PriceChartingClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface PriceChartingHttpClient {
  get(query: Record<string, string | undefined>, signal?: AbortSignal): Promise<unknown>;
}

const BASE_URL = "https://www.pricecharting.com/api/product";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/** Même discipline que les autres clients du paquet — jamais le token dans un message d'erreur. */
export function createPriceChartingClient(options: PriceChartingClientOptions): PriceChartingHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  function buildUrl(query: Record<string, string | undefined>): URL {
    const url = new URL(BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    url.searchParams.set("t", options.token);
    return url;
  }

  async function requestOnce(query: Record<string, string | undefined>, externalSignal?: AbortSignal): Promise<Response> {
    const bounded = createBoundedAbortController(timeoutMs, externalSignal);
    try {
      return await fetchImpl(buildUrl(query).toString(), { method: "GET", signal: bounded.controller.signal });
    } catch (error) {
      if (bounded.outcome() === "external_signal") {
        throw new ConnectorError("Appel PriceCharting abandonné — délai global du run dépassé, jamais une panne fournisseur.", { retryable: false, aborted: true });
      }
      throw error;
    } finally {
      bounded.cleanup();
    }
  }

  function backoffMs(attempt: number): number {
    return Math.min(300 * 2 ** attempt, 4000);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function get(query: Record<string, string | undefined>, signal?: AbortSignal): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(query, signal);
      } catch (error) {
        if (error instanceof ConnectorError && error.aborted) throw error;
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel PriceCharting après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`PriceCharting a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`PriceCharting a répondu ${response.status}.`, { httpStatus: response.status, retryable: false });
    }
  }

  return { get };
}
