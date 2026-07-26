import type {
  MarketplaceConnector,
  SearchQuery,
  SearchResult,
  NormalizedListing,
  HealthCheckResult,
} from "../types";
import { createOAuthTokenProvider } from "./oauth";
import { createEbayHttpClient } from "./client";
import { normalizeEbayItem } from "./normalize";
import type { EbayRawSearchResponse, EbayRawItem } from "./raw-types";

export interface EbayConnectorConfig {
  clientId: string;
  clientSecret: string;
  marketplaceId: string;
  environment: "sandbox" | "production";
  fetchImpl?: typeof fetch;
  onRateLimitInfo?: (headers: Record<string, string>) => void;
}

const DEFAULT_SEARCH_LIMIT = 50;

/**
 * Connecteur eBay — API Browse officielle uniquement, lecture seule.
 * `capabilities` ne déclare jamais `soldPrices` : eBay ne fournit aucune
 * vente conclue accessible avec des identifiants standards (Marketplace
 * Insights API réservée aux partenaires approuvés — voir ADR 0008). Ne
 * déclare pas non plus `stock`/`publish` : non implémentés dans ce lot.
 */
export function createEbayConnector(config: EbayConnectorConfig): MarketplaceConnector {
  const tokenProvider = createOAuthTokenProvider(
    { clientId: config.clientId, clientSecret: config.clientSecret, environment: config.environment },
    config.fetchImpl,
  );
  const client = createEbayHttpClient({
    environment: config.environment,
    marketplaceId: config.marketplaceId,
    tokenProvider,
    fetchImpl: config.fetchImpl,
    onRateLimitInfo: config.onRateLimitInfo,
  });

  return {
    source: "ebay",
    capabilities: ["search", "itemDetails"] as const,

    async search(query: SearchQuery): Promise<SearchResult> {
      const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
      const offset = query.offset ?? 0;
      const collectedAt = new Date().toISOString();

      const raw = (await client.get("/buy/browse/v1/item_summary/search", {
        q: query.q,
        limit,
        offset,
      })) as EbayRawSearchResponse;

      const listings = (raw.itemSummaries ?? [])
        .map((item) => normalizeEbayItem(item, { categorySlug: query.categorySlug, collectedAt }))
        .filter((listing): listing is NormalizedListing => listing !== null);

      const total = raw.total ?? null;
      const hasMore = total !== null ? offset + listings.length < total : listings.length >= limit;

      return { listings, total, offset, limit, hasMore };
    },

    async getItem(externalId: string, categorySlug: string): Promise<NormalizedListing | null> {
      const collectedAt = new Date().toISOString();
      const raw = (await client.get(`/buy/browse/v1/item/${encodeURIComponent(externalId)}`)) as EbayRawItem;
      return normalizeEbayItem(raw, { categorySlug, collectedAt });
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        await tokenProvider.getAccessToken(true);
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : "Échec inconnu de l'authentification eBay.",
        };
      }
    },
  };
}
