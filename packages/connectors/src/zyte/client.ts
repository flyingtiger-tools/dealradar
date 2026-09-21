import { ConnectorError } from "../types";

export interface ZyteClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ZyteExtractRequest {
  url: string;
  /** `httpResponseBody` (rapide, base64) OU `browserHtml` (rendu JS, texte brut) — jamais les deux à la fois dans ce client (voir `provider.ts`, un seul mode par appel). */
  browserHtml?: boolean;
  httpResponseBody?: boolean;
  /** Code pays ISO 3166-1 alpha-2 — voir la doc Zyte "geolocation". */
  geolocation?: string;
}

export interface ZyteExtractResponse {
  url: string;
  statusCode?: number;
  /** Présent seulement si `httpResponseBody: true` a été demandé — encodé en base64 (convention Zyte), jamais décodé par ce client (voir `provider.ts`). */
  httpResponseBody?: string;
  /** Présent seulement si `browserHtml: true` a été demandé — texte brut, pas d'encodage. */
  browserHtml?: string;
}

const BASE_URL = "https://api.zyte.com/v1/extract";
const DEFAULT_TIMEOUT_MS = 30_000; // le rendu JS côté Zyte peut prendre plusieurs secondes — délai plus généreux que les autres clients du paquet.
const DEFAULT_MAX_RETRIES = 2;

/**
 * Client HTTP Zyte API (LOT "Source Wave 2", section 4 — premier
 * fournisseur de scraping géré implémenté) — authentification HTTP Basic
 * avec la clé API comme "username" et un mot de passe vide (convention
 * Zyte documentée), jamais dans l'URL ni journalisée. Aucune logique de
 * contournement anti-bot ici : Zyte gère ça de son côté (règle absolue du
 * lot) — ce client ne fait que traduire `ScrapeRequest` (`../market-
 * intelligence/scraping-provider.ts`) vers leur API REST documentée.
 */
export function createZyteClient(options: ZyteClientOptions): { extract(request: ZyteExtractRequest): Promise<ZyteExtractResponse> } {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  function authHeader(): string {
    // btoa n'existe pas nativement sur toutes les cibles Node anciennes du repo — Buffer est déjà utilisé ailleurs dans ce paquet (voir redact.ts) pour ce type d'encodage.
    return `Basic ${Buffer.from(`${options.apiKey}:`).toString("base64")}`;
  }

  async function requestOnce(request: ZyteExtractRequest): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader() },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  function backoffMs(attempt: number): number {
    return Math.min(500 * 2 ** attempt, 5000);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function extract(request: ZyteExtractRequest): Promise<ZyteExtractResponse> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(request);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel Zyte après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return (await response.json()) as ZyteExtractResponse;

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Zyte a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      // Zyte répond en style "problem+json" (status/type/title) pour les erreurs 4xx — jamais l'URL/clé complète dans le message.
      let title: string | undefined;
      try {
        const body = (await response.json()) as { title?: string };
        title = body.title;
      } catch {
        title = undefined;
      }
      throw new ConnectorError(`Zyte a répondu ${response.status}${title ? ` (${title})` : ""}.`, { httpStatus: response.status, retryable: false });
    }
  }

  return { extract };
}
