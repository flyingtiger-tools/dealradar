import { createPriceChartingClient, type PriceChartingClientOptions } from "./client";
import { normalizePriceChartingProduct } from "./normalize";
import type { PriceChartingProductResponse } from "./raw-types";
import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";
import type { HealthCheckResult } from "../types";
import { ConnectorError } from "../types";

/**
 * Connecteur PriceCharting (LOT "Multi-Source Fusion + Source Wave 1") —
 * API officielle, authentification par jeton en paramètre de requête,
 * lookup par identifiant produit ou code-barres UPC. Déclare
 * `historicalPrices` (valeurs de marché CALCULÉES par PriceCharting à
 * partir de son historique agrégé, jamais une transaction individuelle
 * confirmée — voir `normalize.ts`) + `barcodeLookup` + `search` —
 * **jamais `soldTransactions`**.
 *
 * **Réserve de licence, non vérifiée cette session (aucun credential
 * disponible)** : les conditions d'utilisation commerciale de l'API
 * PriceCharting doivent être reconfirmées avant tout usage en production
 * — même discipline conservatrice que `supportedCategorySlugs`/licence
 * pour Pokémon TCG API (`external-data-sources.md`). Cette limite est
 * documentée ici plutôt que de forcer une intégration non vérifiée —
 * conformément à l'instruction du lot ("stop at a typed adapter/contract
 * instead of forcing it").
 *
 * `search()` exige `query.hints.priceChartingId` OU `query.hints.upc` —
 * jamais un identifiant deviné à partir du texte libre (l'API PriceCharting
 * a un endpoint de recherche par mots-clés, non implémenté ce lot par
 * prudence : sans vérification live, une recherche floue risquerait de
 * faire correspondre le mauvais produit plus souvent qu'un lookup direct).
 */
export function createPriceChartingConnector(options: PriceChartingClientOptions): MarketSource {
  const client = createPriceChartingClient(options);

  return {
    source: "pricecharting",
    displayName: "PriceCharting",
    supportedCategorySlugs: ["gaming", "collectibles"],
    evidenceTypes: ["historicalPrices", "barcodeLookup", "search"],

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const productId = query.hints?.priceChartingId;
      const upc = query.hints?.upc;
      if (typeof productId !== "string" && typeof upc !== "string") return { observations: [] };

      const collectedAt = new Date().toISOString();
      const raw = (await client.get(
        typeof productId === "string" ? { id: productId } : { upc: upc as string },
        query.signal,
      )) as PriceChartingProductResponse;

      if (raw.status === "error") {
        throw new ConnectorError(`PriceCharting a signalé une erreur : ${raw["error-message"] ?? "erreur inconnue"}`, { retryable: false });
      }

      const observations = normalizePriceChartingProduct(raw, { categorySlug: query.categorySlug, query: query.q, collectedAt });
      return { observations };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        await client.get({ id: "1" });
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: null,
          message: error instanceof ConnectorError ? error.message : "Erreur inconnue lors du contrôle de santé PriceCharting.",
        };
      }
    },
  };
}
