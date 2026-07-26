export type ProviderErrorCode = "TIMEOUT" | "NETWORK" | "RATE_LIMIT" | "INVALID_RESPONSE" | "UNAUTHORIZED" | "UNKNOWN";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: { code: ProviderErrorCode; httpStatus?: number | null; retryable?: boolean }) {
    super(message);
    this.name = "ProviderError";
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export interface FetchWithRetryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 2;

function backoffMs(attempt: number): number {
  return Math.min(300 * 2 ** attempt, 4000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

/**
 * Client HTTP générique factorisé une seule fois — réutilisé par tous les
 * providers IA. Timeout, retry+backoff borné sur 429/5xx/erreurs réseau,
 * jamais de retry sur 400/401/403. Aucun secret n'apparaît jamais dans un
 * message d'erreur (le header Authorization n'est jamais journalisé).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeoutHandle);
      const isAbort = error instanceof Error && error.name === "AbortError";
      if (attempt >= maxRetries) {
        throw new ProviderError(
          isAbort ? "Délai dépassé lors de l'appel au provider IA." : "Erreur réseau lors de l'appel au provider IA.",
          { code: isAbort ? "TIMEOUT" : "NETWORK", retryable: true },
        );
      }
      await sleep(backoffMs(attempt));
      attempt += 1;
      continue;
    }
    clearTimeout(timeoutHandle);

    if (response.ok) {
      return response.json();
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(`Provider IA a répondu ${response.status} (authentification).`, {
        code: "UNAUTHORIZED",
        httpStatus: response.status,
        retryable: false,
      });
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= maxRetries) {
        throw new ProviderError(`Provider IA a répondu ${response.status} après ${attempt + 1} tentative(s).`, {
          code: "RATE_LIMIT",
          httpStatus: response.status,
          retryable: true,
        });
      }
      await sleep(retryAfterMs(response) ?? backoffMs(attempt));
      attempt += 1;
      continue;
    }

    throw new ProviderError(`Provider IA a répondu ${response.status}.`, {
      code: "INVALID_RESPONSE",
      httpStatus: response.status,
      retryable: false,
    });
  }
}
