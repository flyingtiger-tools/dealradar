import { ConnectorError } from "../types";

export interface OpenPricesClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
}

export interface OpenPricesHttpClient {
  getPricesByBarcode(barcode: string, pageSize: number, signal?: AbortSignal): Promise<unknown>;
}

const BASE_URL = "https://prices.openfoodfacts.org/api/v1/prices";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_USER_AGENT = "DealRadar/1.0 (+https://dealradar.app)";

/**
 * Client HTTP Open Prices — projet frère d'Open Food Facts (LOT "Free/Open
 * Sources + Real Readiness + Live Smoke Tests", section 6/13). Gratuit,
 * aucune clé API pour une LECTURE (confirmé par appel réel ce lot :
 * `GET /api/v1/prices?product_code=1541513213246`, sans authentification).
 * Même discipline timeout/retry+backoff que les autres clients de ce
 * paquet.
 */
export function createOpenPricesClient(options: OpenPricesClientOptions = {}): OpenPricesHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  async function requestOnce(barcode: string, pageSize: number, externalSignal?: AbortSignal): Promise<Response> {
    const url = new URL(BASE_URL);
    url.searchParams.set("product_code", barcode);
    url.searchParams.set("page_size", String(pageSize));

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort);
    try {
      return await fetchImpl(url.toString(), { method: "GET", headers: { "User-Agent": userAgent }, signal: controller.signal });
    } finally {
      clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  function backoffMs(attempt: number): number {
    return Math.min(300 * 2 ** attempt, 4000);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getPricesByBarcode(barcode: string, pageSize: number, signal?: AbortSignal): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(barcode, pageSize, signal);
      } catch (error) {
        if (signal?.aborted) throw new ConnectorError("Requête Open Prices abandonnée (signal externe).", { retryable: false, aborted: true });
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel Open Prices (${barcode}) après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        void error;
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Open Prices a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`Open Prices a répondu ${response.status} (${barcode}).`, { httpStatus: response.status, retryable: false });
    }
  }

  return { getPricesByBarcode };
}
