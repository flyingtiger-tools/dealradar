import { describe, expect, it, vi } from "vitest";
import { createRicardoConnector } from "../connector";
import type { ScrapingProvider, ScrapeResult } from "../../market-intelligence/scraping-provider";
import { ScrapeError } from "../../market-intelligence/scraping-provider";

function fakeScrapingProvider(scrape: ScrapingProvider["scrape"]): ScrapingProvider {
  return { name: "fake", scrape };
}

function fakeScrapeResult(rawHtml: string | null): ScrapeResult {
  return {
    url: "https://www.ricardo.ch/de/s/x",
    fetchedAt: "2026-09-21T00:00:00.000Z",
    rawHtml,
    extractedFields: {},
    diagnostics: { provider: "fake", latencyMs: 10, estimatedCostUsd: null, usedJsRendering: true, httpStatus: 200 },
  };
}

const PRODUCT_JSON_LD = JSON.stringify({ "@type": "Product", name: "LEGO 10300", sku: "1001", url: "https://ricardo.ch/a", offers: { price: "179.00", priceCurrency: "CHF" } });

describe("createRicardoConnector", () => {
  it("déclare activeListings/search, jamais soldTransactions", () => {
    const connector = createRicardoConnector({ scrapingProvider: fakeScrapingProvider(vi.fn()) });
    expect(connector.evidenceTypes).toContain("activeListings");
    expect(connector.evidenceTypes).not.toContain("soldTransactions");
  });

  it("appelle le ScrapingProvider avec renderJs et country CH, parse le HTML retourné", async () => {
    const scrape = vi.fn().mockResolvedValue(fakeScrapeResult(`<script type="application/ld+json">${PRODUCT_JSON_LD}</script>`));
    const connector = createRicardoConnector({ scrapingProvider: fakeScrapingProvider(scrape) });

    const result = await connector.search({ categorySlug: "lego", q: "lego 10300" });

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.source).toBe("ricardo");
    const [request] = scrape.mock.calls[0]!;
    expect(request.country).toBe("CH");
    expect(request.renderJs).toBe(true);
  });

  it("rawHtml null (provider n'a rien retourné) -> résultat vide, jamais une exception", async () => {
    const scrape = vi.fn().mockResolvedValue(fakeScrapeResult(null));
    const connector = createRicardoConnector({ scrapingProvider: fakeScrapingProvider(scrape) });

    const result = await connector.search({ categorySlug: "lego", q: "lego 10300" });
    expect(result.observations).toEqual([]);
  });

  it("une ScrapeError se propage — jamais masquée en faux succès à 0 résultat (l'agrégateur doit voir un diagnostic 'error')", async () => {
    const scrape = vi.fn().mockRejectedValue(new ScrapeError("bloqué", { reason: "blocked" }));
    const connector = createRicardoConnector({ scrapingProvider: fakeScrapingProvider(scrape) });

    await expect(connector.search({ categorySlug: "lego", q: "lego 10300" })).rejects.toThrow(ScrapeError);
  });

  it("healthCheck() : down si le ScrapingProvider échoue", async () => {
    const scrape = vi.fn().mockRejectedValue(new ScrapeError("bloqué", { reason: "blocked" }));
    const connector = createRicardoConnector({ scrapingProvider: fakeScrapingProvider(scrape) });

    const health = await connector.healthCheck();
    expect(health.status).toBe("down");
  });
});
