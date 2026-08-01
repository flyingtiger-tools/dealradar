import { ConnectorError } from "../types";
import { ebayApiHost, type OAuthTokenProvider, type EbayOAuthConfig } from "./oauth";

export interface EbayClientOptions {
  environment: EbayOAuthConfig["environment"];
  marketplaceId: string;
  tokenProvider: OAuthTokenProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Reçoit les en-têtes de rate-limit bruts (retry-after, x-ratelimit-*) quand présents — jamais de secret. */
  onRateLimitInfo?: (headers: Record<string, string>) => void;
}

interface RequestSpec {
  method?: string;
  query?: Record<string, string | number | undefined>;
}

export interface EbayHttpClient {
  get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Client HTTP eBay : timeout, retry+backoff borné sur 429/5xx/erreurs réseau,
 * un seul refresh-token-puis-retry sur 401, jamais de retry sur 400/403/404.
 * Aucun secret ni token n'apparaît jamais dans un message d'erreur ou un log.
 */
export function createEbayHttpClient(options: EbayClientOptions): EbayHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function requestOnce(path: string, spec: RequestSpec, token: string): Promise<Response> {
    const url = new URL(`${ebayApiHost(options.environment)}${path}`);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), {
        method: spec.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": options.marketplaceId,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      // TEMP DIAG (à retirer après investigation Production) — aucun secret : URL, marketplace, statut HTTP uniquement.
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          diag: "ebay-http-request",
          url: url.toString(),
          marketplaceId: options.marketplaceId,
          status: response.status,
        }),
      );
      return response;
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

  async function get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    let attempt = 0;
    let triedTokenRefresh = false;
    let token = await options.tokenProvider.getAccessToken();

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(path, { query }, token);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(
            `Délai dépassé ou erreur réseau lors de l'appel eBay (${path}) après ${attempt + 1} tentative(s).`,
            { retryable: true },
          );
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      reportRateLimitHeaders(response);

      if (response.ok) {
        const body = (await response.json()) as { total?: number; itemSummaries?: unknown[] };
        // TEMP DIAG (à retirer après investigation Production) — aucun secret : total/nombre d'items uniquement.
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify({
            diag: "ebay-http-body",
            total: body?.total ?? null,
            itemCount: Array.isArray(body?.itemSummaries) ? body.itemSummaries.length : null,
          }),
        );
        return body;
      }

      if (response.status === 401 && !triedTokenRefresh) {
        triedTokenRefresh = true;
        token = await options.tokenProvider.getAccessToken(true);
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`eBay a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
            httpStatus: response.status,
            retryable: true,
          });
        }
        await sleep(retryAfterMs(response) ?? backoffMs(attempt));
        attempt += 1;
        continue;
      }

      // TEMP DIAG (à retirer après investigation Production) — corps d'erreur eBay, aucun secret dedans.
      const errorBody = await response
        .clone()
        .json()
        .catch(() => null);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ diag: "ebay-http-error", status: response.status, errorBody }));

      throw new ConnectorError(`eBay a répondu ${response.status} (${path}).`, {
        httpStatus: response.status,
        retryable: false,
      });
    }
  }

  return { get };
}

function backoffMs(attempt: number): number {
  return Math.min(300 * 2 ** attempt, 4000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
