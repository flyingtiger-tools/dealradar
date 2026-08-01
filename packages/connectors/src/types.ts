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

/**
 * Socle commun aux quatre familles de connecteurs (ADR 0012 §2-§5). Purement
 * additif à ce fichier : `MarketplaceConnector` et le connecteur eBay restent
 * inchangés — cette base ne sert qu'aux nouvelles familles (Catalog en
 * premier). La migration éventuelle d'eBay vers ce socle est un chantier
 * séparé, non couvert ici.
 */
export interface QualityScore {
  reliability: number;
  coverage: number;
  freshness: number;
  latency: number;
  confidence: number;
}

export interface CostModel {
  model: "free" | "freemium" | "paid";
  details: string;
}

export interface QuotaModel {
  perSecond?: number;
  perDay?: number;
  notes?: string;
}

export interface LicenseModel {
  allowsCommercialUse: boolean;
  allowsCaching: boolean;
  maxCacheAgeHours: number | null;
  allowsRedistribution: boolean;
  termsUrl: string;
}

export interface CachePolicy {
  ttlHours: number;
  staleWhileRevalidate: boolean;
}

export type ConnectorFamily = "marketplace" | "catalog" | "pricing" | "ai";

export interface ConnectorDescriptor {
  readonly source: string;
  readonly displayName: string;
  readonly family: ConnectorFamily;
  /** Versionnées : "catalog.resolve.v1", jamais une capacité implicite (ADR 0012 §5). */
  readonly capabilities: readonly string[];
  readonly supportedCategorySlugs: readonly string[] | "any";
  readonly declaredQuality: QualityScore;
  readonly cost: CostModel;
  readonly quotas: QuotaModel;
  readonly license: LicenseModel;
  readonly cachePolicy: CachePolicy;
  healthCheck(): Promise<HealthCheckResult>;
}

/**
 * Métadonnée de prix tiers (TCGPlayer, Cardmarket, etc.) — jamais une vente
 * confirmée. `provenance` documente explicitement la nature du chiffre pour
 * qu'aucun appelant ne puisse le confondre avec un `NormalizedSoldPrice`
 * (réservé aux Pricing Connectors, ADR 0012 §7).
 */
export interface ThirdPartyPriceHint {
  source: string;
  variant: string | null;
  priceLow: number | null;
  priceMid: number | null;
  priceHigh: number | null;
  currency: string;
  observedAt: string | null;
  provenance: "listing_aggregate";
}

/** Identité canonique résolue par un Catalog Connector (ADR 0012, contrat exact). */
export interface CatalogItem {
  source: string;
  externalId: string;
  /** Ex. `TcgProductKind` pour un connecteur TCG — générique ici, chaque famille de catalogue définit son propre vocabulaire de `kind`. */
  kind: string;
  categorySlug: string;
  name: string;
  canonicalAttributes: Record<string, string | number | boolean | null>;
  images: string[];
  externalUrl: string | null;
  /** Prix tiers non confirmés, jamais une vente — voir `ThirdPartyPriceHint`. */
  priceHints?: ThirdPartyPriceHint[];
  raw?: unknown;
}

export interface CatalogMatch {
  item: CatalogItem;
  /** 0–1, calculée honnêtement à partir des indices qui ont réellement matché — jamais une estimation devinée. */
  confidence: number;
  matchedOn: string[];
}

export interface CatalogQuery {
  categorySlug: string;
  /** Bag ouvert — chaque connecteur catalogue interprète les indices pertinents à son domaine (voir `TcgCatalogHints` pour les jeux de cartes). */
  hints: Record<string, unknown>;
}

export interface CatalogConnector extends ConnectorDescriptor {
  resolve(query: CatalogQuery): Promise<CatalogMatch[]>;
  getItem(externalId: string): Promise<CatalogItem | null>;
}
