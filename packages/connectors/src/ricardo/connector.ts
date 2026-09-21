import { parseRicardoListingHtml } from "./parse";
import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";
import type { ScrapingProvider } from "../market-intelligence/scraping-provider";
import type { HealthCheckResult } from "../types";

export interface RicardoConnectorOptions {
  scrapingProvider: ScrapingProvider;
}

/**
 * Connecteur Ricardo.ch (LOT "Source Wave 2", section 3) — assemble un
 * `ScrapingProvider` générique (ex. `createZyteScrapingProvider`, voir
 * `../zyte/provider.ts`) avec `parseRicardoListingHtml` (`./parse.ts`).
 *
 * **NE PAS ACTIVER EN PRODUCTION sans clarification légale/technique** —
 * voir l'en-tête de `parse.ts` et `docs/market-intelligence-sources.md` :
 * Ricardo.ch utilise Cloudflare, son `robots.txt` exclut explicitement les
 * robots de scraping connus ET désautorise toute URL de recherche avec
 * paramètres de requête (`Disallow: /*\/s/*?`) — exactement le motif d'URL
 * qu'une recherche automatisée par mots-clés utiliserait. Ce connecteur
 * existe pour compléter l'architecture (contrat + fixtures testables), pas
 * comme une recommandation d'usage immédiat.
 */
export function createRicardoConnector(options: RicardoConnectorOptions): MarketSource {
  return {
    source: "ricardo",
    displayName: "Ricardo.ch (extraction de page publique)",
    supportedCategorySlugs: "any",
    evidenceTypes: ["activeListings", "search"],

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const collectedAt = new Date().toISOString();
      const pageUrl = `https://www.ricardo.ch/de/s/${encodeURIComponent(query.q)}`;

      // `ScrapeError` n'est jamais interceptée ici — elle doit se propager pour que
      // l'agrégateur (`aggregate-market-observations.ts`) l'enregistre honnêtement
      // comme un diagnostic "error", jamais masquée en faux succès à 0 résultat.
      const scraped = await options.scrapingProvider.scrape({ url: pageUrl, country: "CH", renderJs: true, signal: query.signal });
      if (!scraped.rawHtml) return { observations: [] };

      const observations = parseRicardoListingHtml(scraped.rawHtml, { query: query.q, collectedAt, pageUrl });
      return { observations, hasMore: undefined };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        await options.scrapingProvider.scrape({ url: "https://www.ricardo.ch/de", country: "CH" });
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: null,
          message: error instanceof Error ? error.message : "Erreur inconnue lors du contrôle de santé Ricardo.",
        };
      }
    },
  };
}
