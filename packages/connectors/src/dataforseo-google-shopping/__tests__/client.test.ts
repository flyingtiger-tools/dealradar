import { describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../../types";
import { createDataForSeoClient } from "../client";

function abortAwareFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  }) as unknown as typeof fetch;
}

describe("createDataForSeoClient — abort (LOT 'Interactive History...', section 6)", () => {
  it("postTask : signal externe abandonné en cours de vol : ConnectorError.aborted=true, jamais retenté", async () => {
    const fetchImpl = abortAwareFetch();
    const externalController = new AbortController();
    const client = createDataForSeoClient({ login: "l", password: "p", fetchImpl, timeoutMs: 5000, maxRetries: 3 });

    const pending = client.postTask({ keyword: "iphone", location_code: 2756, language_code: "en" }, externalController.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    externalController.abort();

    await expect(pending).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).aborted).toBe(true);
      expect((error as ConnectorError).retryable).toBe(false);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("getTask : signal externe abandonné en cours de vol : ConnectorError.aborted=true, jamais retenté", async () => {
    const fetchImpl = abortAwareFetch();
    const externalController = new AbortController();
    const client = createDataForSeoClient({ login: "l", password: "p", fetchImpl, timeoutMs: 5000, maxRetries: 3 });

    const pending = client.getTask("task-1", externalController.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    externalController.abort();

    await expect(pending).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ConnectorError);
      expect((error as ConnectorError).aborted).toBe(true);
      return true;
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rétrocompatible : aucun signal fourni, comportement par timeout seul inchangé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tasks: [] }), { status: 200 }));
    const client = createDataForSeoClient({ login: "l", password: "p", fetchImpl });

    await expect(client.postTask({ keyword: "iphone", location_code: 2756, language_code: "en" })).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
