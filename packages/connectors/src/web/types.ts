/**
 * Frontière technique pour un futur moteur de récupération web (Scrapling
 * ou autre) derrière les marketplaces qui n'ont pas d'API officielle
 * (Phase 9, ADR 0013). Aucun site n'est scrapé dans ce lot, aucun
 * navigateur n'est lancé, aucune protection anti-bot n'est contournée —
 * types, interfaces et mocks uniquement.
 *
 * Architecture visée (jamais implémentée ici) :
 *
 *   RicardoConnector  implements MarketplaceConnector (../types.ts)
 *     -> WebMarketplaceFetcher (ce fichier)
 *         -> Scrapling (ou équivalent, voir docs/ai-ingestion-foundation.md, section 7)
 *
 *   AnibisConnector    implements MarketplaceConnector
 *     -> WebMarketplaceFetcher
 *         -> Scrapling
 *
 *   EbayConnector      implements MarketplaceConnector
 *     -> API officielle (client.ts/oauth.ts) — jamais remplacée par Scrapling.
 *
 * `WebMarketplaceFetcher` ne fait QUE récupérer une page — aucune logique de
 * parsing ici, exactement comme `EbayHttpClient` ne fait que l'appel HTTP
 * (le parsing vit dans `normalize.ts`). Un futur `RicardoConnector`
 * interprète le HTML lui-même et produit un `NormalizedListing` (../types.ts,
 * déjà existant — jamais un second contrat de sortie).
 */

export interface WebFetchRequest {
  url: string;
  method?: "GET";
  headers?: Record<string, string>;
}

export interface WebFetchResult {
  status: number;
  /** Corps brut de la page — jamais déjà parsé ici, voir le commentaire de fichier. */
  body: string;
  fetchedAt: string;
  latencyMs: number;
}

export class WebFetchError extends Error {
  readonly retryable: boolean;
  readonly blocked: boolean;

  constructor(message: string, options: { retryable?: boolean; blocked?: boolean } = {}) {
    super(message);
    this.name = "WebFetchError";
    this.retryable = options.retryable ?? false;
    /** true si une protection anti-bot a été détectée (ex. mur CAPTCHA, 403 générique du fournisseur anti-bot) — jamais contourné ici, seulement rapporté. */
    this.blocked = options.blocked ?? false;
  }
}

/**
 * Contrat minimal qu'un moteur de récupération (Scrapling ou autre) doit
 * remplir — une seule méthode, aucune généralisation prématurée.
 */
export interface WebMarketplaceFetcher {
  fetch(request: WebFetchRequest): Promise<WebFetchResult>;
}

/**
 * Métriques futures pour observer la santé d'un `WebMarketplaceFetcher` en
 * production (PREPARED — aucun code ne les calcule encore automatiquement).
 * `parseDrift` : incrémenté manuellement par le futur connecteur quand un
 * sélecteur/pattern attendu ne matche plus — signal de rupture de structure
 * de page, distinct d'un échec réseau.
 */
export interface WebFetchMetrics {
  fetchSuccessCount: number;
  fetchFailureCount: number;
  parsingSuccessCount: number;
  parsingFailureCount: number;
  missingPriceCount: number;
  missingTitleCount: number;
  parseDriftCount: number;
  blockedCount: number;
  latenciesMs: number[];
}

export function emptyWebFetchMetrics(): WebFetchMetrics {
  return {
    fetchSuccessCount: 0,
    fetchFailureCount: 0,
    parsingSuccessCount: 0,
    parsingFailureCount: 0,
    missingPriceCount: 0,
    missingTitleCount: 0,
    parseDriftCount: 0,
    blockedCount: 0,
    latenciesMs: [],
  };
}
