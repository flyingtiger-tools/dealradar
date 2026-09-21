import type { EvidenceCapabilities, EvidenceType } from "./evidence-types";
import type { MarketObservation } from "./market-observation";
import type { HealthCheckResult } from "../types";

/**
 * Requête envoyée à une source de marché — volontairement minimale et
 * ouverte (pas de champ spécifique à une catégorie ici, voir `hints` pour
 * les indices propres à chaque source, même discipline que `CatalogQuery`/
 * `PricingQuery`, `../types.ts`).
 */
export interface MarketSourceQuery {
  categorySlug: string;
  q: string;
  /** Indices additionnels que la source sait interpréter (ex. `gtin`, `mpn`) — jamais une supposition si absent. */
  hints?: Record<string, unknown>;
  limit?: number;
  /** Pays/marché ciblé si la source le supporte — `undefined` = défaut de la source, jamais une valeur inventée par l'appelant. */
  country?: string;
}

export interface MarketSourceResult {
  observations: MarketObservation[];
  /** `true` si la source elle-même signale qu'il existe plus de résultats que ceux retournés — `false`/`undefined` sinon, jamais deviné. */
  hasMore?: boolean;
}

/**
 * Contrat d'une source de marché "large" (LOT "Multi-Source Market
 * Intelligence Foundation") — distinct de `MarketplaceConnector` (eBay,
 * `../types.ts`) et des familles `CatalogConnector`/`PricingConnector`
 * (TCG) : ce contrat sert spécifiquement l'agrégateur multi-source et
 * retourne toujours des `MarketObservation[]`, jamais un format
 * intermédiaire. Un connecteur EXISTANT (eBay, Catalog, Pricing) n'a pas
 * besoin d'implémenter ce contrat pour continuer de fonctionner —
 * `packages/ingestion/src/aggregate-market-observations.ts` sait adapter
 * eBay séparément (voir son en-tête).
 */
export interface MarketSource extends EvidenceCapabilities {
  readonly source: string;
  readonly displayName: string;
  readonly supportedCategorySlugs: readonly string[] | "any";
  /**
   * `"direct"` (défaut si absent) = le connecteur EST l'origine des
   * observations qu'il produit (ex. BrickLink, Keepa, eBay). `"aggregator"`
   * = le connecteur restitue des offres d'AUTRES marchands (ex. Google
   * Shopping/DataForSEO) — `MarketObservation.marketplace` porte alors
   * l'origine réelle (LOT "Source Wave 3", section 9 : compte "direct vs
   * aggregated source count" dans les diagnostics de provenance).
   */
  readonly sourceKind?: "direct" | "aggregator";
  search(query: MarketSourceQuery): Promise<MarketSourceResult>;
  healthCheck(): Promise<HealthCheckResult>;
}

export function marketSourceSupportsEvidenceType(source: MarketSource, type: EvidenceType): boolean {
  return source.evidenceTypes.includes(type);
}

export function marketSourceSupportsCategory(source: MarketSource, categorySlug: string): boolean {
  return source.supportedCategorySlugs === "any" || source.supportedCategorySlugs.includes(categorySlug);
}
