import { ConnectorError } from "../types";
import type { DataForSeoTaskGetResponse, DataForSeoTaskPostRequestItem, DataForSeoTaskPostResponse } from "./raw-types";

export interface DataForSeoClientOptions {
  login: string;
  password: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

const BASE_URL = "https://api.dataforseo.com/v3/merchant/google/products";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;

export interface DataForSeoHttpClient {
  postTask(params: DataForSeoTaskPostRequestItem): Promise<DataForSeoTaskPostResponse>;
  getTask(taskId: string): Promise<DataForSeoTaskGetResponse>;
}

/**
 * Client HTTP DataForSEO Merchant API (LOT "Source Wave 3", section 2) —
 * authentification HTTP Basic (`login`/`password`, jamais journalisés ni
 * inclus dans un message d'erreur), même discipline de retry/backoff que
 * les autres clients du paquet.
 */
export function createDataForSeoClient(options: DataForSeoClientOptions): DataForSeoHttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  function authHeader(): string {
    return `Basic ${Buffer.from(`${options.login}:${options.password}`).toString("base64")}`;
  }

  async function requestOnce(path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${BASE_URL}${path}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", Authorization: authHeader() },
        body: body ? JSON.stringify([body]) : undefined,
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

  async function requestWithRetry(path: string, body?: unknown): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await requestOnce(path, body);
      } catch {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`Délai dépassé ou erreur réseau lors de l'appel DataForSEO après ${attempt + 1} tentative(s).`, { retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      if (response.ok) return response.json();

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          throw new ConnectorError(`DataForSEO a répondu ${response.status} après ${attempt + 1} tentative(s).`, { httpStatus: response.status, retryable: true });
        }
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }

      throw new ConnectorError(`DataForSEO a répondu ${response.status}.`, { httpStatus: response.status, retryable: false });
    }
  }

  return {
    async postTask(params) {
      return (await requestWithRetry("/task_post", params)) as DataForSeoTaskPostResponse;
    },
    async getTask(taskId) {
      return (await requestWithRetry(`/task_get/advanced/${taskId}`)) as DataForSeoTaskGetResponse;
    },
  };
}
