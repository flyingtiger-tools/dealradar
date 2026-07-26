import type { ItemCondition } from "../types/domain";

/**
 * Vocabulaire du cœur d'intelligence (Lot 3).
 * Distinct de types/domain.ts : ces types ne sont pas alignés sur une table
 * Supabase, ils décrivent l'entrée/sortie d'un moteur pur, sans I/O.
 */

/** Annonce normalisée, quelle que soit sa source (marketplace non branchée en V1). */
export interface NormalizedListing {
  id: string;
  sourceSlug: string;
  title: string;
  description?: string;
  priceCents: number;
  currency: string;
  condition: ItemCondition;
  categorySlug: string;
  brandSlug?: string;
  attributes: Record<string, string | number | boolean>;
  postedAt?: string;
}

/**
 * Comparable normalisé. `soldAt: null` signifie une annonce active (prix
 * demandé, pas confirmé) — voir ADR 0007 : jamais utilisée pour l'estimation.
 */
export interface NormalizedComparable {
  id: string;
  sourceSlug: string;
  title: string;
  priceCents: number;
  currency: string;
  condition: ItemCondition;
  categorySlug: string;
  brandSlug?: string;
  attributes: Record<string, string | number | boolean>;
  soldAt: string | null;
}

export type MarketplaceCapability = "search" | "itemDetails" | "soldPrices" | "stock" | "publish";

export interface ConnectorSearchQuery {
  categorySlug: string;
  q?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface StockInfo {
  externalId: string;
  quantityAvailable: number;
}

export interface PublishResult {
  externalId: string;
  url: string;
}

/**
 * Contrat d'un connecteur marketplace, capacités déclarées explicitement.
 * Aucune implémentation réelle en V1 (pas d'eBay/Ricardo, pas de scraping) —
 * le pipeline ne l'appelle jamais : il consomme des candidats déjà rassemblés.
 */
export interface MarketplaceConnector {
  readonly slug: string;
  readonly capabilities: readonly MarketplaceCapability[];
  search?(query: ConnectorSearchQuery): Promise<NormalizedListing[]>;
  itemDetails?(externalId: string): Promise<NormalizedListing | null>;
  soldPrices?(query: ConnectorSearchQuery): Promise<NormalizedComparable[]>;
  stock?(externalId: string): Promise<StockInfo>;
  publish?(listing: NormalizedListing): Promise<PublishResult>;
}

export function hasCapability(
  connector: MarketplaceConnector,
  capability: MarketplaceCapability,
): boolean {
  return connector.capabilities.includes(capability);
}

export type CategoryProfileSlug = "lego" | "pokemon_tcg" | "apple" | "gaming" | "photo";

export interface RiskSignal {
  id: string;
  description: string;
  /** Points retirés de la confiance quand ce signal se déclenche. */
  penalty: number;
  test(listing: NormalizedListing): boolean;
}

/**
 * Configuration déclarative d'une catégorie — consommée par un moteur
 * générique unique (identify.ts/comparables.ts/scores.ts). Aucune logique
 * spécifique à une catégorie n'existe ailleurs dans le code.
 */
export interface CategoryProfile {
  slug: CategoryProfileSlug;
  label: string;
  requiredAttributeKeys: string[];
  similarityAttributeKeys: string[];
  riskSignals: RiskSignal[];
  minSoldComparablesForStrongRecommendation: number;
  confidencePenaltyPerMissingField: number;
}

export interface StructuredIdentity {
  categorySlug: string;
  profile: CategoryProfile | null;
  missingRequiredFields: string[];
  matchedRiskSignals: RiskSignal[];
}

export interface PriceEstimate {
  sampleSize: number;
  medianCents: number;
  p25Cents: number;
  p75Cents: number;
  /** Figure prudente utilisée pour le calcul de profit — voir ADR 0007. */
  conservativeCents: number;
}

export interface CostInputs {
  purchasePriceCents: number;
  shippingCostCents: number;
  /** Fraction du prix de revente, ex. 0.12 pour 12 %. */
  platformFeeRate: number;
  refurbCostCents: number;
  /** Fraction du prix de revente mise en réserve pour couvrir l'incertitude. */
  riskReserveRate: number;
}

export interface NetProfitResult {
  resaleBasisCents: number;
  platformFeeCents: number;
  riskReserveCents: number;
  totalCostCents: number;
  netProfitCents: number;
  marginRatio: number;
}

export type Decision = "BUY" | "REVIEW" | "PASS" | "INSUFFICIENT_DATA";

export interface WhyFactor {
  id: string;
  label: string;
  direction: "positive" | "negative" | "neutral";
  detail: string;
}

export interface WhyPanel {
  decision: Decision;
  summary: string;
  factors: WhyFactor[];
}

export interface IntelligenceScores {
  deal: number | null;
  confidence: number;
  liquidity: number;
}

export interface IntelligencePipelineInput {
  listing: NormalizedListing;
  /** Pool de comparables déjà rassemblés (par un futur connecteur) — aucun I/O ici. */
  candidates: NormalizedComparable[];
  costs: CostInputs;
  /** Horodatage de référence explicite — jamais Date.now() interne (déterminisme). */
  asOf: string;
}

export interface IntelligencePipelineResult {
  identity: StructuredIdentity;
  comparables: {
    matched: NormalizedComparable[];
    used: NormalizedComparable[];
    excludedOutliers: NormalizedComparable[];
  };
  estimate: PriceEstimate | null;
  netProfit: NetProfitResult | null;
  scores: IntelligenceScores;
  decision: Decision;
  whyPanel: WhyPanel;
}
