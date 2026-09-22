import { ConnectorError } from "../../types";

export interface RebrickableClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface RebrickableHttpClient {
  getSet(setNum: string): Promise<unknown>;
}

const BASE_URL = "https://rebrickable.com/api/v3";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Client HTTP Rebrickable v3 — clé API gratuite en libre-service requise
 * (`REBRICKABLE_API_KEY`, audit ce lot, LOT "Free/Open Sources + Real
 * Readiness + Live Smoke Tests", section 4). Schéma d'authentification
 * `Authorization: key <clé>` confirmé par un appel réel SANS clé ce lot
 * (`GET /api/v3/lego/sets/{set_num}/` -> `401 Unauthorized`,
 * `www-authenticate: Key`) — jamais un en-tête Bearer/Basic deviné. Limite
 * de débit documentée par les conditions d'utilisation Rebrickable :
 * ~1 requête/seconde en moyenne, avec une tolérance de rafale limitée —
 * ce client ne l'applique pas lui-même (aucun état partagé entre appels),
 * c'est la responsabilité de l'appelant en Production.
 */
export function createRebrickableClient(options: RebrickableClientOptions): RebrickableHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function requestOnce(setNum: string): Promise<Response> {
    const url = `${BASE_URL}/lego/sets/${encodeURIComponent(setNum)}/`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Jamais la clé en query string (contrairement à Keepa) — l'en-tête
      // `Authorization` est le schéma documenté par Rebrickable lui-même
      // (confirmé par le `www-authenticate: Key` d'une réponse 401 réelle),
      // et évite qu'elle apparaisse dans un log d'URL.
      return await fetchImpl(url, { method: "GET", headers: { Authorization: `key ${options.apiKey}` }, signal: controller.signal });
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

  async function getSet(setNum: string): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(setNum);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel Rebrickable (${setNum}) après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();
      if (response.status === 404) throw new ConnectorError(`Set LEGO introuvable sur Rebrickable (${setNum}).`, { httpStatus: 404, retryable: false });
      if (response.status === 401) throw new ConnectorError("Clé Rebrickable invalide ou absente (401) — jamais réessayé.", { httpStatus: 401, retryable: false });

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Rebrickable a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`Rebrickable a répondu ${response.status} (${setNum}).`, { httpStatus: response.status, retryable: false });
    }
  }

  return { getSet };
}
