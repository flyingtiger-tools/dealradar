import { describe, expect, it } from "vitest";
import { createMockScrapingProvider, ScrapeError } from "../scraping-provider";

describe("createMockScrapingProvider", () => {
  it("retourne la réponse configurée pour une URL", async () => {
    const provider = createMockScrapingProvider({
      "https://example.com/a": {
        url: "https://example.com/a",
        fetchedAt: "2026-09-21T00:00:00.000Z",
        rawHtml: null,
        extractedFields: { price: 42 },
        diagnostics: { provider: "mock", latencyMs: 10, estimatedCostUsd: 0.001, usedJsRendering: false, httpStatus: 200 },
      },
    });

    const result = await provider.scrape({ url: "https://example.com/a" });

    expect(result.extractedFields.price).toBe(42);
    expect(provider.name).toBe("mock");
  });

  it("URL non configurée : lève une ScrapeError not_found, jamais une réponse fabriquée", async () => {
    const provider = createMockScrapingProvider({});
    await expect(provider.scrape({ url: "https://example.com/unknown" })).rejects.toThrow(ScrapeError);
  });

  it("peut simuler un blocage anti-bot (reason: 'blocked')", async () => {
    const provider = createMockScrapingProvider({
      "https://example.com/blocked": new ScrapeError("Bloqué par une protection anti-bot.", { reason: "blocked", retryable: false }),
    });

    await expect(provider.scrape({ url: "https://example.com/blocked" })).rejects.toMatchObject({ reason: "blocked" });
  });
});
