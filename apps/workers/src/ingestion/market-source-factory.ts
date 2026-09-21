import {
  createEbayMarketSourceAdapter,
  createGoogleShoppingConnector,
  createBrickLinkConnector,
  createPriceChartingConnector,
  createKeepaConnector,
  createZyteScrapingProvider,
  createRicardoConnector,
  createDataForSeoGoogleShoppingConnector,
  type MarketSource,
} from "@dealradar/connectors";
import { logger } from "../logger";
import { tryBuildEbayConnectorFromEnv } from "./connector-config";

/**
 * Usine de sources de marché (LOT "Source Wave 2", section 5) — construit
 * toutes les `MarketSource[]` disponibles DEPUIS L'ENVIRONNEMENT du
 * process workers. Une source dont les credentials/config sont absents ne
 * bloque JAMAIS la construction des autres (même discipline que
 * `tryBuildEbayConnectorFromEnv`, `connector-config.ts`) — les diagnostics
 * ne portent QUE des noms de source et un booléen `enabled`, jamais une
 * valeur de credential (règle absolue de tous les lots précédents).
 */
export interface MarketSourceDiagnosticEntry {
  name: string;
  enabled: boolean;
}

export interface BuildMarketSourcesResult {
  sources: MarketSource[];
  diagnostics: MarketSourceDiagnosticEntry[];
}

function tryBuildSource(name: string, build: () => MarketSource | null): { source: MarketSource | null; diagnostic: MarketSourceDiagnosticEntry } {
  try {
    const source = build();
    return { source, diagnostic: { name, enabled: source !== null } };
  } catch (error) {
    logger.warn(
      { name, error: error instanceof Error ? error.message : "erreur inconnue" },
      `Source de marché "${name}" non construite depuis l'environnement`,
    );
    return { source: null, diagnostic: { name, enabled: false } };
  }
}

/**
 * Ricardo.ch n'est PAS recommandé pour une activation en production (voir
 * `docs/market-intelligence-sources.md` et l'en-tête de
 * `packages/connectors/src/ricardo/connector.ts` : Cloudflare + robots.txt
 * excluant explicitement les recherches paramétrées). Construit ici
 * uniquement si `ZYTE_API_KEY` est présent — reste un no-op tant qu'aucune
 * clé n'est posée, exactement comme eBay l'a longtemps été dans ce fichier
 * (`connector-config.ts`). N'importe QUEL futur retrait de cette source du
 * registre reste une décision produit distincte, jamais bloquée par ce
 * fichier.
 */
function tryBuildRicardo(): MarketSource | null {
  const zyteApiKey = process.env.ZYTE_API_KEY;
  if (!zyteApiKey) return null;
  return createRicardoConnector({ scrapingProvider: createZyteScrapingProvider({ apiKey: zyteApiKey }) });
}

function tryBuildGoogleShopping(): MarketSource | null {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return null;
  return createGoogleShoppingConnector({ apiKey });
}

/** Suisse (code de géociblage Google Ads officiel, vérifié ce lot) — même défaut que `createGoogleShoppingConnector`'s `defaultCountry: "ch"`, jamais une supposition non documentée. `DATAFORSEO_LOCATION_CODE` permet de le surcharger sans redéploiement de code si un futur marché l'exige. */
const DEFAULT_DATAFORSEO_LOCATION_CODE = 2756;

function tryBuildDataForSeoGoogleShopping(): MarketSource | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  const locationCodeOverride = process.env.DATAFORSEO_LOCATION_CODE ? Number(process.env.DATAFORSEO_LOCATION_CODE) : undefined;
  return createDataForSeoGoogleShoppingConnector({
    login,
    password,
    defaultLocationCode: locationCodeOverride && Number.isFinite(locationCodeOverride) ? locationCodeOverride : DEFAULT_DATAFORSEO_LOCATION_CODE,
  });
}

function tryBuildBrickLink(): MarketSource | null {
  const consumerKey = process.env.BRICKLINK_CONSUMER_KEY;
  const consumerSecret = process.env.BRICKLINK_CONSUMER_SECRET;
  const token = process.env.BRICKLINK_TOKEN_VALUE;
  const tokenSecret = process.env.BRICKLINK_TOKEN_SECRET;
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) return null;
  return createBrickLinkConnector({ consumerKey, consumerSecret, token, tokenSecret });
}

function tryBuildPriceCharting(): MarketSource | null {
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token) return null;
  return createPriceChartingConnector({ token });
}

/** Nom canonique exigé par le lot ("support a canonical KEEPA_API_KEY env name"). */
function tryBuildKeepa(): MarketSource | null {
  const apiKey = process.env.KEEPA_API_KEY;
  if (!apiKey) return null;
  return createKeepaConnector({ apiKey });
}

function tryBuildEbayMarketSource(): MarketSource | null {
  const connector = tryBuildEbayConnectorFromEnv();
  return connector ? createEbayMarketSourceAdapter(connector) : null;
}

export function buildMarketSourcesFromEnv(): BuildMarketSourcesResult {
  const results = [
    tryBuildSource("ebay", tryBuildEbayMarketSource),
    tryBuildSource("google_shopping", tryBuildGoogleShopping),
    tryBuildSource("dataforseo_google_shopping", tryBuildDataForSeoGoogleShopping),
    tryBuildSource("bricklink", tryBuildBrickLink),
    tryBuildSource("pricecharting", tryBuildPriceCharting),
    tryBuildSource("keepa", tryBuildKeepa),
    tryBuildSource("ricardo", tryBuildRicardo),
  ];

  return {
    sources: results.flatMap((r) => (r.source ? [r.source] : [])),
    diagnostics: results.map((r) => r.diagnostic),
  };
}
