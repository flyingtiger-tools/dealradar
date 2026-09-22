import { describe, expect, it, vi } from "vitest";
import { createWikidataClient } from "../client";
import { ConnectorError } from "../../../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createWikidataClient", () => {
  it("effectue une requête SPARQL avec un User-Agent identifiable, sans aucune clé API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ head: { vars: [] }, results: { bindings: [] } }));
    const client = createWikidataClient({ fetchImpl });
    await client.query("SELECT ?item WHERE { ?item wdt:P3962 \"x\" . }");
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(String(url)).toContain("query.wikidata.org/sparql");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/DealRadar/);
    expect((init.headers as Record<string, string>).Accept).toBe("application/sparql-results+json");
  });

  it("respecte un timeout et lève une ConnectorError retryable", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;
    const client = createWikidataClient({ fetchImpl, timeoutMs: 20, maxRetries: 0 });
    await expect(client.query("x")).rejects.toBeInstanceOf(ConnectorError);
  });

  it("abandonne après le nombre maximal de tentatives sur 429 — retry BAS par défaut (étiquette Wikidata)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("slow down", { status: 429 }));
    const client = createWikidataClient({ fetchImpl, maxRetries: 0 });
    await expect(client.query("x")).rejects.toSatisfy((error: unknown) => {
      expect((error as ConnectorError).httpStatus).toBe(429);
      return true;
    });
  });
});
