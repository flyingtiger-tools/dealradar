import { ConnectorError } from "../types";
import { createBoundedAbortController } from "../http-abort";
import type { KeepaProductResponse } from "./raw-types";

export interface KeepaClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface KeepaHttpClient {
  getProduct(query: { asin?: string; code?: string; domain: number; history?: boolean }, signal?: AbortSignal): Promise<KeepaProductResponse>;
}

const BASE_URL = "https://api.keepa.com/product";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;

/** Même discipline que les autres clients du paquet (eBay/BrickLink/PriceCharting/SerpApi) — la clé API est un paramètre de requête (convention Keepa), jamais journalisée ni incluse dans un message d'erreur. */
export function createKeepaClient(options: KeepaClientOptions): KeepaHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  function buildUrl(query: { asin?: string; code?: string; domain: number; history?: boolean }): URL {
    const url = new URL(BASE_URL);
    url.searchParams.set("key", options.apiKey);
    url.searchParams.set("domain", String(query.domain));
    if (query.asin) url.searchParams.set("asin", query.asin);
    if (query.code) url.searchParams.set("code", query.code);
    if (query.history !== undefined) url.searchParams.set("history", query.history ? "1" : "0");
    return url;
  }

  async function requestOnce(query: { asin?: string; code?: string; domain: number; history?: boolean }, externalSignal?: AbortSignal): Promise<Response> {
    const bounded = createBoundedAbortController(timeoutMs, externalSignal);
    try {
      return await fetchImpl(buildUrl(query).toString(), { method: "GET", signal: bounded.controller.signal });
    } catch (error) {
      if (bounded.outcome() === "external_signal") {
        throw new ConnectorError("Appel Keepa abandonné — délai global du run dépassé, jamais une panne fournisseur.", { retryable: false, aborted: true });
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

  async function getProduct(query: { asin?: string; code?: string; domain: number; history?: boolean }, signal?: AbortSignal): Promise<KeepaProductResponse> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(query, signal);
      } catch (error) {
        if (error instanceof ConnectorError && error.aborted) throw error;
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel Keepa après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return (await response.json()) as KeepaProductResponse;

      // 429 = quota de "tokens" Keepa épuisé (mécanisme documenté de leur API, distinct d'un rate-limit HTTP classique) — retenté comme les autres 429/5xx.
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Keepa a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`Keepa a répondu ${response.status}.`, { httpStatus: response.status, retryable: false });
    }
  }

  return { getProduct };
}
