import { ConnectorError } from "../../types";

export interface WikidataClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * `User-Agent` avec coordonnée de contact (LOT "Free/Open Sources + Real
   * Readiness + Live Smoke Tests", section 5) — la politique User-Agent
   * de la Wikimedia Foundation classe les requêtes SANS contact identifiable
   * dans un palier de débit restrictif visant les scrapeurs anonymes
   * (audit confirmé ce lot) ; un en-tête conforme est donc une exigence
   * fonctionnelle, pas seulement une politesse.
   */
  userAgent?: string;
}

export interface WikidataHttpClient {
  query(sparql: string): Promise<unknown>;
}

const ENDPOINT = "https://query.wikidata.org/sparql";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_USER_AGENT = "DealRadar/1.0 (+https://dealradar.app; contact@dealradar.app)";

/**
 * Client SPARQL Wikidata — CC0, aucune clé API (confirmé par appel réel
 * ce lot). Requêtes SÉRIELLES uniquement (jamais parallèles — étiquette
 * opérationnelle documentée par Wikidata, audit ce lot) : c'est la
 * responsabilité de l'APPELANT, ce client ne sérialise rien lui-même.
 * `maxRetries` volontairement bas par défaut (1, contre 2-3 ailleurs) :
 * l'étiquette Wikidata demande un repli respectueux plutôt qu'un
 * martèlement en cas de 429/limite de requête dépassée.
 */
export function createWikidataClient(options: WikidataClientOptions = {}): WikidataHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  async function requestOnce(sparql: string): Promise<Response> {
    const url = new URL(ENDPOINT);
    url.searchParams.set("query", sparql);
    url.searchParams.set("format", "json");

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url.toString(), {
        method: "GET",
        headers: { Accept: "application/sparql-results+json", "User-Agent": userAgent },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  function backoffMs(attempt: number): number {
    return Math.min(500 * 2 ** attempt, 4000);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function query(sparql: string): Promise<unknown> {
    let attempt = 0;

    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(sparql);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de la requête SPARQL Wikidata après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Wikidata a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`Wikidata a répondu ${response.status}.`, { httpStatus: response.status, retryable: false });
    }
  }

  return { query };
}
