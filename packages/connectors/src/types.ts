/**
 * Vocabulaire de la couche connecteurs (Lot 4).
 * Distinct de packages/core/src/intelligence/types.ts : ce module décrit ce
 * qu'un connecteur de marketplace peut renvoyer, riche et traçable jusqu'à la
 * source. Intelligence Core ne connaît jamais ce format — voir
 * @dealradar/ingestion pour le mapping explicite entre les deux mondes.
 */

export type ItemConditionRaw =
  | "new"
  | "like_new"
  | "very_good"
  | "good"
  | "fair"
  | "for_parts"
  | null;

export interface NormalizedSeller {
  externalId: string | null;
  username: string | null;
  feedbackScore: number | null;
  feedbackPercentage: number | null;
}

export interface NormalizedPrice {
  amountCents: number;
  currency: string;
}

export interface NormalizedImage {
  url: string;
  position: number;
}

export interface NormalizedLocation {
  country: string | null;
  postalCode: string | null;
  text: string | null;
}

/** Traçabilité obligatoire : d'où vient cette donnée, quand, et comment la retrouver. */
export interface SourceMetadata {
  source: string;
  externalId: string;
  originalUrl: string;
  collectedAt: string;
  /** Payload source brut (ou une référence traçable) — minimisé avant persistance, voir redact.ts. */
  rawPayloadRef?: unknown;
}

export interface NormalizedListing {
  meta: SourceMetadata;
  title: string;
  description?: string;
  price: NormalizedPrice;
  shippingCostCents: number | null;
  condition: ItemConditionRaw;
  /** Slug de catégorie DealRadar (lego/pokemon_tcg/apple/gaming/photo), assigné par l'appelant — jamais déduit du format source. */
  categorySlug: string;
  attributes: Record<string, string | number | boolean>;
  location: NormalizedLocation;
  images: NormalizedImage[];
  seller: NormalizedSeller;
  postedAt: string | null;
}

export type MarketplaceCapability = "search" | "itemDetails" | "soldPrices" | "stock" | "publish";

export interface SearchQuery {
  q: string;
  categorySlug: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  listings: NormalizedListing[];
  total: number | null;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export type ConnectorStatus = "ok" | "degraded" | "down";

export interface HealthCheckResult {
  status: ConnectorStatus;
  checkedAt: string;
  latencyMs: number | null;
  message?: string;
}

export class ConnectorError extends Error {
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: { httpStatus?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "ConnectorError";
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * Contrat générique d'un connecteur marketplace. Les capacités déclarées
 * doivent refléter honnêtement ce que la source fournit réellement — un
 * connecteur ne doit jamais déclarer `soldPrices` s'il ne peut produire que
 * des annonces actives (voir ADR 0008).
 */
export interface MarketplaceConnector {
  readonly source: string;
  readonly capabilities: readonly MarketplaceCapability[];
  search(query: SearchQuery): Promise<SearchResult>;
  /** `categorySlug` requis : jamais de valeur de catégorie fabriquée par le connecteur. */
  getItem(externalId: string, categorySlug: string): Promise<NormalizedListing | null>;
  healthCheck(): Promise<HealthCheckResult>;
}

export function hasCapability(
  connector: MarketplaceConnector,
  capability: MarketplaceCapability,
): boolean {
  return connector.capabilities.includes(capability);
}
