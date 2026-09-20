import type { ItemCondition } from "../types/domain";
import type { CategorySlug as CategoryProfileSlug } from "@dealradar/contracts";

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

/** Source de vérité : @dealradar/contracts (`CategorySlug`). Nom historique conservé ici pour ne casser aucun import existant. */
export type { CategoryProfileSlug };

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

/**
 * Nature de l'évidence de marché réellement utilisée pour l'estimation
 * (LOT "Universal Object Valuation Foundation") — `"sold"` : ventes
 * confirmées (comportement historique, inchangé). `"active_listing"` :
 * aucune vente confirmée disponible, repli sur des annonces actives
 * (prix demandé, jamais confirmé) comme preuve plus faible — jamais
 * présentée comme "dernières ventes" (voir `marketDataProvenanceSchema`,
 * `@dealradar/contracts`, qui distingue déjà `sold_transaction` de
 * `active_listing`).
 */
export type EvidenceTier = "sold" | "active_listing";

export interface PriceEstimate {
  sampleSize: number;
  medianCents: number;
  p25Cents: number;
  p75Cents: number;
  /** Figure prudente utilisée pour le calcul de profit — voir ADR 0007. */
  conservativeCents: number;
  /**
   * Optionnel : `estimatePrice()` (`estimate.ts`) ne le renseigne jamais —
   * c'est `runIntelligencePipeline()` qui l'attache après coup selon le
   * pool de comparables réellement utilisé, pour ne jamais toucher
   * `estimate.ts`/ses tests (fonction statistique pure, agnostique de la
   * provenance de ses entrées).
   */
  evidenceTier?: EvidenceTier;
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
  /** Toujours la vente confirmée (`soldAt !== null`) — sémantique inchangée depuis Lot 3, jamais réinterprétée. */
  comparables: {
    matched: NormalizedComparable[];
    used: NormalizedComparable[];
    excludedOutliers: NormalizedComparable[];
  };
  /**
   * Annonces actives (`soldAt === null`) parmi le même pool `candidates` —
   * calculées systématiquement (coût négligeable, pur), qu'elles servent ou
   * non à l'estimation finale (`estimate.evidenceTier`). N'alimente
   * `estimate`/`netProfit`/`scores` QUE quand `comparables.used` est vide —
   * voir `pipeline.ts`. Jamais un remplacement des ventes confirmées quand
   * elles existent.
   */
  activeComparables: {
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
