import { describe, expect, it, vi } from "vitest";
import { ConnectorError } from "../../types";
import { createKeepaClient } from "../client";

function abortAwareFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
  }) as unknown as typeof fetch;
}

describe("createKeepaClient — abort (LOT 'Interactive History...', section 6)", () => {
  it("signal externe abandonné en cours de vol : ConnectorError.aborted=true, jamais retenté, jamais confondu avec une panne fournisseur", async () => {
    const fetchImpl = abortAwareFetch();
    const externalController = new AbortController();
    const client = createKeepaClient({ apiKey: "k", fetchImpl, timeoutMs: 5000, maxRetries: 3 });

    const pending = client.getProduct({ asin: "B00005N5PF", domain: 4 }, externalController.signal);
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

  it("rétrocompatible : aucun signal fourni, comportement par timeout seul inchangé", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: [] }), { status: 200 }));
    const client = createKeepaClient({ apiKey: "k", fetchImpl });

    await expect(client.getProduct({ asin: "B00005N5PF", domain: 4 })).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
