import {
  createEbayMarketSourceAdapter,
  createGoogleShoppingConnector,
  createBrickLinkConnector,
  createPriceChartingConnector,
  createKeepaConnector,
  createZyteScrapingProvider,
  createRicardoConnector,
  createDataForSeoGoogleShoppingConnector,
  SOURCE_READINESS_MATRIX,
  resolveSourceReadiness,
  type ActivationStatus,
  type MarketSource,
} from "@dealradar/connectors";
import { logger } from "../logger";
import { tryBuildEbayConnectorFromEnv } from "./connector-config";

/**
 * Usine de sources de marché (LOT "Source Wave 2", section 5 ; rendue
 * consciente de la préparation live au LOT "Close the Refresh Loop",
 * section 6) — construit toutes les `MarketSource[]` disponibles DEPUIS
 * L'ENVIRONNEMENT du process workers. Une source dont les credentials/config
 * sont absents ne bloque JAMAIS la construction des autres (même
 * discipline que `tryBuildEbayConnectorFromEnv`, `connector-config.ts`) —
 * les diagnostics ne portent QUE des noms de source et des statuts, jamais
 * une valeur de credential (règle absolue de tous les lots précédents).
 *
 * IMPORTANT (changement de comportement délibéré de ce lot) : avant
 * d'appeler le builder d'une source, on consulte
 * `SOURCE_READINESS_MATRIX`/`resolveSourceReadiness`. Un verrou de
 * politique (`restricted`/`disabled_policy`/`license_required`) ou
 * `productionAllowed: false` bloque la construction MÊME SI toutes les
 * credentials requises sont présentes — la présence d'une clé API ne peut
 * jamais outrepasser une décision de politique produit. Concrètement :
 * Ricardo (`restricted`) et PriceCharting (`license_required`) cessent
 * d'être construits par cette fabrique tant qu'un futur lot ne change pas
 * explicitement leur `policyStatus` dans la matrice.
 */
export interface MarketSourceDiagnosticEntry {
  name: string;
  enabled: boolean;
  /** Statut de préparation résolu (matrice + présence de credentials) — absent si la source n'est pas répertoriée dans la matrice. */
  readiness?: ActivationStatus;
}

export interface BuildMarketSourcesResult {
  sources: MarketSource[];
  diagnostics: MarketSourceDiagnosticEntry[];
}

/** Résout le statut de préparation pour une source nommée — jamais lu depuis process.env directement dans la matrice elle-même (voir source-readiness-matrix.ts). */
function readinessFor(name: string): ActivationStatus | undefined {
  const descriptor = SOURCE_READINESS_MATRIX.find((d) => d.source === name);
  if (!descriptor) return undefined;
  const envPresence: Record<string, boolean> = {};
  for (const envVar of descriptor.requiredEnvVars) envPresence[envVar] = Boolean(process.env[envVar]);
  return resolveSourceReadiness(descriptor, envPresence);
}

/** `true` seulement si la matrice autorise explicitement la construction — un verrou de politique prime toujours sur la présence de credentials. */
function isConstructionAllowed(name: string, readiness: ActivationStatus | undefined): boolean {
  if (readiness === undefined) return true; // source hors matrice (pas encore répertoriée) — ne bloque pas, comportement historique préservé.
  const descriptor = SOURCE_READINESS_MATRIX.find((d) => d.source === name);
  if (descriptor && !descriptor.productionAllowed) return false;
  return readiness !== "restricted" && readiness !== "disabled_policy" && readiness !== "license_required";
}

function tryBuildSource(name: string, build: () => MarketSource | null): { source: MarketSource | null; diagnostic: MarketSourceDiagnosticEntry } {
  const readiness = readinessFor(name);

  if (!isConstructionAllowed(name, readiness)) {
    logger.warn({ name, readiness }, `Source de marché "${name}" verrouillée par la politique de préparation — jamais construite malgré des credentials éventuellement présentes`);
    return { source: null, diagnostic: { name, enabled: false, readiness } };
  }

  try {
    const source = build();
    return { source, diagnostic: { name, enabled: source !== null, readiness } };
  } catch (error) {
    logger.warn(
      { name, error: error instanceof Error ? error.message : "erreur inconnue" },
      `Source de marché "${name}" non construite depuis l'environnement`,
    );
    return { source: null, diagnostic: { name, enabled: false, readiness } };
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
