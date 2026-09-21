import { createSerpApiClient, type SerpApiClientOptions } from "./client";
import { normalizeSerpApiGoogleShoppingResponse } from "./normalize";
import type { SerpApiGoogleShoppingResponse } from "./raw-types";
import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";
import type { HealthCheckResult } from "../types";
import { ConnectorError } from "../types";

export interface GoogleShoppingConnectorOptions extends SerpApiClientOptions {
  /** `"ch"` par défaut — jamais un marché deviné si l'appelant n'en précise pas un. */
  defaultCountry?: string;
}

/**
 * Premier nouveau connecteur "marché large" (LOT "Multi-Source Market
 * Intelligence Foundation") — Google Shopping via SerpApi, choisi plutôt
 * qu'un scraper maison : API officielle documentée, aucune authentification
 * à contourner, tarification claire, données déjà structurées (voir
 * `docs/market-intelligence-sources.md`). Déclare `retailPrices` +
 * `activeListings` (jamais `soldTransactions` — Google Shopping n'expose
 * aucune vente conclue) et `search` (recherche par mots-clés, pas de
 * lookup par identifiant produit unique aujourd'hui).
 */
export function createGoogleShoppingConnector(options: GoogleShoppingConnectorOptions): MarketSource {
  const client = createSerpApiClient(options);
  const defaultCountry = options.defaultCountry ?? "ch";

  return {
    source: "google_shopping",
    displayName: "Google Shopping (SerpApi)",
    supportedCategorySlugs: "any",
    // Restitue des offres d'AUTRES marchands, jamais l'origine directe — voir `MarketSource.sourceKind`.
    sourceKind: "aggregator",
    evidenceTypes: ["retailPrices", "activeListings", "search"],

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const country = query.country ?? defaultCountry;
      const collectedAt = new Date().toISOString();

      const raw = (await client.get({
        engine: "google_shopping",
        q: query.q,
        gl: country,
        num: query.limit,
      })) as SerpApiGoogleShoppingResponse;

      if (raw.error) {
        throw new ConnectorError(`SerpApi a signalé une erreur : ${raw.error}`, { retryable: false });
      }

      const observations = normalizeSerpApiGoogleShoppingResponse(raw, {
        categorySlug: query.categorySlug,
        query: query.q,
        country,
        collectedAt,
      });

      return { observations, hasMore: undefined };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        await client.get({ engine: "google_shopping", q: "test", gl: defaultCountry, num: 1 });
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: null,
          message: error instanceof ConnectorError ? error.message : "Erreur inconnue lors du contrôle de santé SerpApi.",
        };
      }
    },
  };
}
