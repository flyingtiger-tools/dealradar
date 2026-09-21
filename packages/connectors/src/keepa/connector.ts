import { createKeepaClient, type KeepaClientOptions } from "./client";
import { normalizeKeepaProduct, type DownsampleOptions } from "./normalize";
import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";
import type { HealthCheckResult } from "../types";
import { ConnectorError } from "../types";

export interface KeepaConnectorOptions extends KeepaClientOptions {
  /** Domaine Keepa par défaut si `query.country` n'est pas fourni ou non reconnu — `1` (US, `.com`) par défaut : le marché Amazon le mieux couvert par Keepa, jamais un marché suisse deviné (Keepa n'opère aucun domaine `.ch`). */
  defaultDomainId?: number;
  downsample?: DownsampleOptions;
}

/** Inverse de la table pays/devise de `normalize.ts` — reconstruite ici plutôt qu'exportée en double, un seul point de vérité (`DOMAIN_TO_MARKET`). */
const COUNTRY_TO_DOMAIN: Record<string, number> = {
  US: 1,
  GB: 2,
  DE: 3,
  FR: 4,
  JP: 5,
  CA: 6,
  IT: 8,
  ES: 9,
  IN: 10,
  MX: 11,
  BR: 12,
};

/**
 * Connecteur Keepa (LOT "Source Wave 2") — historique de prix Amazon
 * spécialisé. Jamais une recherche floue : `search()` exige
 * `hints.asin` OU `hints.upc`/`hints.ean` (le paramètre `code` de l'API
 * Keepa), exactement comme BrickLink (`hints.bricklinkNo`) et PriceCharting
 * (`hints.priceChartingId`/`hints.upc`) dans ce même paquet — jamais un
 * ASIN deviné à partir d'un simple texte de requête.
 */
export function createKeepaConnector(options: KeepaConnectorOptions): MarketSource {
  const client = createKeepaClient(options);
  const defaultDomainId = options.defaultDomainId ?? 1;

  return {
    source: "keepa",
    displayName: "Keepa (historique Amazon)",
    supportedCategorySlugs: ["gaming", "apple", "pc_components"],
    evidenceTypes: ["retailPrices", "historicalPrices", "barcodeLookup"],

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const asin = typeof query.hints?.asin === "string" ? query.hints.asin : undefined;
      const upc = typeof query.hints?.upc === "string" ? query.hints.upc : undefined;
      const ean = typeof query.hints?.ean === "string" ? query.hints.ean : undefined;
      const code = upc ?? ean;
      if (!asin && !code) return { observations: [] };

      const domainId = (query.country && COUNTRY_TO_DOMAIN[query.country.toUpperCase()]) || defaultDomainId;
      const collectedAt = new Date().toISOString();

      const raw = await client.getProduct({ asin, code, domain: domainId, history: true });
      if (raw.error) {
        throw new ConnectorError(`Keepa a signalé une erreur : ${raw.error}`, { retryable: false });
      }

      const observations = (raw.products ?? []).flatMap((product) =>
        normalizeKeepaProduct(product, { query: query.q, domainId, collectedAt, downsample: options.downsample }),
      );

      return { observations, hasMore: undefined };
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        // ASIN de test stable et public, utilisé communément pour vérifier une clé Keepa (produit Amazon de référence, jamais un ASIN client réel).
        await client.getProduct({ asin: "B00005N5PF", domain: defaultDomainId, history: false });
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: null,
          message: error instanceof ConnectorError ? error.message : "Erreur inconnue lors du contrôle de santé Keepa.",
        };
      }
    },
  };
}
