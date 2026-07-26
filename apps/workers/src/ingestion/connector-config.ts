import { createEbayConnector, type MarketplaceConnector } from "@dealradar/connectors";
import { logger } from "../logger";

/**
 * Construit le connecteur eBay depuis les variables d'environnement du
 * process workers. Les clés eBay ne vivent jamais ailleurs (jamais dans
 * apps/web) — voir ADR 0008.
 */
export function buildEbayConnectorFromEnv(): MarketplaceConnector {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID;
  const environment = process.env.EBAY_ENVIRONMENT;

  if (!clientId || !clientSecret || !marketplaceId || !environment) {
    throw new Error(
      "Configuration eBay incomplète : EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_MARKETPLACE_ID et EBAY_ENVIRONMENT sont requis.",
    );
  }
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error('EBAY_ENVIRONMENT doit valoir "sandbox" ou "production".');
  }

  return createEbayConnector({
    clientId,
    clientSecret,
    marketplaceId,
    environment,
    onRateLimitInfo: (headers) => logger.warn({ headers }, "eBay : en-têtes de rate-limit reçus"),
  });
}
