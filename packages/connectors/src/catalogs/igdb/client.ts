import { ConnectorError } from "../../types";
import { createTwitchOAuthTokenProvider, type TwitchOAuthTokenProvider, type TwitchOAuthConfig } from "./oauth";

export interface IgdbClientOptions extends TwitchOAuthConfig {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injectable pour les tests — un fournisseur de token déjà construit remplace `createTwitchOAuthTokenProvider`. */
  tokenProvider?: TwitchOAuthTokenProvider;
}

export interface IgdbHttpClient {
  /** `apicalypseBody` — syntaxe de requête PROPRIÉTAIRE IGDB (`fields ...; where ...; limit ...;`), jamais du JSON. */
  post(endpoint: string, apicalypseBody: string): Promise<unknown>;
}

const BASE_URL = "https://api.igdb.com/v4";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Client HTTP IGDB v4 — authentification Twitch OAuth confirmée par appel
 * réel ce lot (LOT "Free/Open Sources + Real Readiness + Live Smoke
 * Tests", section 7) : `POST api.igdb.com/v4/games` sans authentification
 * valide renvoie un message d'erreur documentant EXACTEMENT les en-têtes
 * requis (`Client-ID`, `Authorization: Bearer <token>`), jamais un schéma
 * deviné. Corps de requête en syntaxe Apicalypse (texte, pas JSON) —
 * confirmé par la même réponse d'erreur réelle.
 *
 * `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` absentes de cet environnement ce
 * lot — AUCUNE réponse de jeu réelle n'a pu être capturée (voir
 * `raw-types.ts` pour le détail honnête de ce qui reste non vérifié).
 */
export function createIgdbClient(options: IgdbClientOptions): IgdbHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const tokenProvider = options.tokenProvider ?? createTwitchOAuthTokenProvider(options, fetchImpl);

  async function requestOnce(endpoint: string, apicalypseBody: string, accessToken: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Client-ID": options.clientId, Authorization: `Bearer ${accessToken}`, "Content-Type": "text/plain" },
        body: apicalypseBody,
        signal: controller.signal,
      });
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

  async function post(endpoint: string, apicalypseBody: string): Promise<unknown> {
    let attempt = 0;
    let refreshedOnce = false;

    for (;;) {
      const accessToken = await tokenProvider.getAccessToken();
      let response: Response;
      try {
        response = await requestOnce(endpoint, apicalypseBody, accessToken);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel IGDB (${endpoint}) après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();

      // Token expiré/révoqué entre deux appels (rare, cache mémoire déjà
      // marge de 60s) — UN SEUL rafraîchissement forcé tenté, jamais une
      // boucle infinie de rafraîchissement.
      if (response.status === 401 && !refreshedOnce) {
        refreshedOnce = true;
        await tokenProvider.getAccessToken(true);
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`IGDB a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`IGDB a répondu ${response.status} (${endpoint}).`, { httpStatus: response.status, retryable: false });
    }
  }

  return { post };
}
