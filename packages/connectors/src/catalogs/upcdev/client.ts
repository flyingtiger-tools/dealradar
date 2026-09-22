import { ConnectorError } from "../../types";

export interface UpcDevClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface UpcDevHttpClient {
  getProduct(upc: string): Promise<unknown>;
}

const BASE_URL = "https://upc.dev";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Client HTTP upc.dev v1 (LOT "Live Identity Enrichment + Barcode-First +
 * upc.dev Fallback + Railway Readiness", section 3) — audit des conditions
 * d'utilisation effectué ce lot AVANT toute implémentation
 * (`docs/free-open-sources-audit.md` pour le détail complet) : usage
 * commercial permis ("perpetual license to use responses in your product.
 * You can cache, display, and derive from the data"), seule restriction
 * pertinente = ne jamais redistribuer un dump brut en masse (jamais
 * l'intention ici — un lookup exact à la fois). Authentification confirmée
 * par le schéma OpenAPI public (`components.securitySchemes.ApiKeyAuth`,
 * `https://upc.dev/openapi.json`) : en-tête `X-API-Key`, JAMAIS une query
 * string (évite qu'elle apparaisse dans un log d'URL, même discipline que
 * Rebrickable).
 *
 * Appels RÉELS effectués ce lot (sans clé, palier public "basic data" —
 * suffisant pour confirmer la forme de réponse, jamais pour un débit de
 * Production) : `049000042566` → succès (donnée réellement backée par Open
 * Food Facts, `image_url` pointe vers `images.openfoodfacts.org` — upc.dev
 * agrège des sources ouvertes existantes, jamais une base indépendante
 * pour ce genre de produit). `000000000000` → `404` avec
 * `{"code":"INVALID_UPC"}` (PAS un code "NOT_FOUND" distinct malgré ce que
 * suggère la doc OpenAPI publique pour une 400 — un appel réel PENDANT une
 * fenêtre de démarrage à froid du service a aussi renvoyé `503` avec un
 * corps TEXTE BRUT non-JSON ("upc.dev is warming this page..."), jamais un
 * corps JSON — d'où la discipline ci-dessous de ne JAMAIS appeler
 * `.json()` avant d'avoir vérifié `response.ok`.
 */
export function createUpcDevClient(options: UpcDevClientOptions): UpcDevHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function requestOnce(upc: string): Promise<Response> {
    const url = `${BASE_URL}/v1/product/${encodeURIComponent(upc)}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { method: "GET", headers: { "X-API-Key": options.apiKey }, signal: controller.signal });
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

  async function getProduct(upc: string): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(upc);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel upc.dev (${upc}) après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      // JAMAIS `.json()` avant `response.ok` — une réponse `503` réelle
      // observée ce lot renvoie un corps TEXTE BRUT, pas du JSON (voir
      // en-tête de fonction).
      if (response.ok) return response.json();

      // 404 confirmé en direct comme le statut RÉEL de "aucun produit pour
      // ce code-barres" (y compris pour un format syntaxiquement invalide,
      // malgré ce que suggère la doc publique pour une 400 séparée) —
      // jamais réessayé, jamais un cas d'erreur.
      if (response.status === 404) throw new ConnectorError(`Aucun produit upc.dev pour ce code-barres (${upc}).`, { httpStatus: 404, retryable: false });
      if (response.status === 400) throw new ConnectorError(`Format de code-barres invalide pour upc.dev (${upc}).`, { httpStatus: 400, retryable: false });
      if (response.status === 401) throw new ConnectorError("Clé upc.dev invalide ou absente (401) — jamais réessayé.", { httpStatus: 401, retryable: false });

      // Couvre le `429` documenté ET le `503` "warming" observé en direct
      // ce lot (démarrage à froid transitoire, jamais une panne durable).
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`upc.dev a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`upc.dev a répondu ${response.status} (${upc}).`, { httpStatus: response.status, retryable: false });
    }
  }

  return { getProduct };
}
