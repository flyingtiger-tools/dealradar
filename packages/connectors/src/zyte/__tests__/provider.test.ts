import { describe, expect, it, vi } from "vitest";
import { createZyteScrapingProvider } from "../provider";
import { ScrapeError } from "../../market-intelligence/scraping-provider";

function fakeFetch(responses: { status: number; body: unknown }[]): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    const { status, body } = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("createZyteScrapingProvider", () => {
  it("nom du provider = 'zyte'", () => {
    const provider = createZyteScrapingProvider({ apiKey: "k", fetchImpl: fakeFetch([{ status: 200, body: {} }]) });
    expect(provider.name).toBe("zyte");
  });

  it("sans renderJs : demande httpResponseBody, décode le base64 en HTML brut", async () => {
    const html = "<html><body>Hello</body></html>";
    const fetchImpl = fakeFetch([{ status: 200, body: { url: "https://example.com", statusCode: 200, httpResponseBody: Buffer.from(html).toString("base64") } }]);
    const provider = createZyteScrapingProvider({ apiKey: "k", fetchImpl });

    const result = await provider.scrape({ url: "https://example.com" });

    expect(result.rawHtml).toBe(html);
    expect(result.diagnostics.usedJsRendering).toBe(false);
    expect(result.extractedFields).toEqual({});
    const sentBody = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as string);
    expect(sentBody).toEqual({ url: "https://example.com", httpResponseBody: true, geolocation: undefined });
  });

  it("avec renderJs: true : demande browserHtml, jamais les deux modes en même temps", async () => {
    const html = "<html><body>Rendered</body></html>";
    const fetchImpl = fakeFetch([{ status: 200, body: { url: "https://example.com", statusCode: 200, browserHtml: html } }]);
    const provider = createZyteScrapingProvider({ apiKey: "k", fetchImpl });

    const result = await provider.scrape({ url: "https://example.com", renderJs: true });

    expect(result.rawHtml).toBe(html);
    expect(result.diagnostics.usedJsRendering).toBe(true);
    const sentBody = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as string);
    expect(sentBody.browserHtml).toBe(true);
    expect(sentBody.httpResponseBody).toBeUndefined();
  });

  it("transmet le géociblage pays quand fourni", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { url: "https://example.com", statusCode: 200, httpResponseBody: "" } }]);
    const provider = createZyteScrapingProvider({ apiKey: "k", fetchImpl });

    await provider.scrape({ url: "https://example.com", country: "CH" });

    const sentBody = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as string);
    expect(sentBody.geolocation).toBe("CH");
  });

  it("authentification HTTP Basic avec la clé API en nom d'utilisateur, mot de passe vide", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { url: "https://example.com", statusCode: 200, httpResponseBody: "" } }]);
    const provider = createZyteScrapingProvider({ apiKey: "secret-key", fetchImpl });

    await provider.scrape({ url: "https://example.com" });

    const headers = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("secret-key:").toString("base64")}`);
  });

  it("estimatedCostUsd est toujours null (Zyte n'expose pas de coût par requête dans /v1/extract) — jamais un coût inventé", async () => {
    const fetchImpl = fakeFetch([{ status: 200, body: { url: "https://example.com", statusCode: 200, httpResponseBody: "" } }]);
    const provider = createZyteScrapingProvider({ apiKey: "k", fetchImpl });

    const result = await provider.scrape({ url: "https://example.com" });

    expect(result.diagnostics.estimatedCostUsd).toBeNull();
  });

  it("erreur 400 -> ScrapeError raison 'invalid_request'", async () => {
    const fetchImpl = fakeFetch([{ status: 400, body: { status: 400, type: "/request/invalid-parameter", title: "Invalid parameter" } }]);
    const provider = createZyteScrapingProvider({ apiKey: "k", fetchImpl });

    await expect(provider.scrape({ url: "https://example.com" })).rejects.toThrow(ScrapeError);
    try {
      await provider.scrape({ url: "https://example.com" });
    } catch (error) {
      expect((error as ScrapeError).reason).toBe("invalid_request");
    }
  });

  it("erreur 521 (site inaccessible) -> ScrapeError raison 'not_found'", async () => {
    const fetchImpl = fakeFetch([{ status: 521, body: { status: 521, type: "/website/domain-unreachable", title: "Domain unreachable" } }]);
    const provider = createZyteScrapingProvider({ apiKey: "k", fetchImpl, maxRetries: 0 });

    try {
      await provider.scrape({ url: "https://example.com" });
      throw new Error("devait lever");
    } catch (error) {
      expect((error as ScrapeError).reason).toBe("not_found");
    }
  });

  it("jamais la clé API dans un message d'erreur", async () => {
    const fetchImpl = fakeFetch([{ status: 400, body: { status: 400, type: "/x", title: "Bad request" } }]);
    const provider = createZyteScrapingProvider({ apiKey: "super-secret-zyte-key", fetchImpl });

    try {
      await provider.scrape({ url: "https://example.com" });
      throw new Error("devait lever");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-zyte-key");
    }
  });
});
