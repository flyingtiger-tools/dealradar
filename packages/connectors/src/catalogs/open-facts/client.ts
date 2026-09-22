import { ConnectorError } from "../../types";

export interface OpenFactsClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** ex. "https://world.openfoodfacts.org" — jamais codé en dur ici, un client sert Open Food Facts ET Open Products Facts (même API Product Opener, hôtes distincts). */
  baseUrl: string;
  /**
   * `User-Agent` explicite (LOT "Free/Open Sources + Real Readiness + Live
   * Smoke Tests", section 3) — aucune limite de débit précise n'est
   * documentée publiquement pour l'API Product Opener (confirmé par audit
   * ce lot), mais l'usage établi de la communauté Open Food Facts recommande
   * un en-tête identifiant l'application plutôt que la valeur par défaut du
   * runtime — bonne pratique défensive, jamais une exigence vérifiée comme
   * bloquante.
   */
  userAgent?: string;
}

export interface OpenFactsHttpClient {
  /** Lecture EXACTE par code-barres (GTIN/EAN/UPC) uniquement — jamais une recherche textuelle floue (voir `connector.ts`). */
  getProductByBarcode(barcode: string, fields: readonly string[]): Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_USER_AGENT = "DealRadar/1.0 (+https://dealradar.app)";

/**
 * Client HTTP Product Opener (Open Food Facts / Open Products Facts) —
 * gratuit, AUCUNE clé API pour une lecture GET (confirmé par appel réel à
 * `world.openfoodfacts.org/api/v2/product/{barcode}.json` ce lot, sans
 * aucun en-tête d'authentification). Même discipline timeout/retry+backoff
 * borné que les autres clients (TCGdex) — jamais de retry sur un code hors
 * 429/5xx.
 */
export function createOpenFactsHttpClient(options: OpenFactsClientOptions): OpenFactsHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  async function requestOnce(barcode: string, fields: readonly string[]): Promise<Response> {
    const url = new URL(`${baseUrl}/api/v2/product/${encodeURIComponent(barcode)}.json`);
    if (fields.length > 0) url.searchParams.set("fields", fields.join(","));

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url.toString(), { method: "GET", headers: { "User-Agent": userAgent }, signal: controller.signal });
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

  async function getProductByBarcode(barcode: string, fields: readonly string[]): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(barcode, fields);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel Open Facts (${barcode}) après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      // `status: 0`/`status_verbose` DANS le corps JSON (jamais un HTTP 404)
      // signale honnêtement "aucun produit à ce code-barres" — confirmé par
      // appel réel ce lot (`"product not found"`, et un cas réel inattendu :
      // `"product found with a different product type: beauty"` pour un
      // code appartenant à un projet frère distinct, JAMAIS traité comme
      // une correspondance ici). L'appelant (`normalize.ts`) décide, ce
      // client se contente de renvoyer le JSON fidèlement.
      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Open Facts a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`Open Facts a répondu ${response.status} (${barcode}).`, { httpStatus: response.status, retryable: false });
    }
  }

  return { getProductByBarcode };
}
