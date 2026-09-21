/**
 * Modèle de capacités par TYPE DE PREUVE (LOT "Multi-Source Market
 * Intelligence Foundation") — remplace/complète `MarketplaceCapability`
 * (`../types.ts`, `"search"|"itemDetails"|"soldPrices"|"stock"|"publish"`),
 * trop grossier pour distinguer HONNÊTEMENT ce qu'une source fournit
 * réellement. Une source ne doit jamais déclarer `search` seul quand une
 * sémantique de preuve plus riche est connue (ex. eBay Browse API sait
 * qu'il fournit des `activeListings`, jamais des `soldTransactions` — voir
 * ADR 0008, déjà appliqué à `packages/connectors/src/ebay/connector.ts`).
 *
 * Volontairement séparé de `MarketplaceCapability` : ce fichier n'existe
 * QUE pour les nouvelles sources "marché large" (Google Shopping, Keepa,
 * BrickLink, StockX, etc.) et le nouvel agrégateur multi-source — jamais
 * un remplacement rétroactif d'eBay/Catalog/Pricing Connectors, qui
 * restent inchangés et continuent de fonctionner tels quels (LOT "ne
 * jamais casser la verticale TCG").
 */

/**
 * Types de preuve qu'une source peut déclarer. Chaque valeur correspond à
 * une sémantique honnête et vérifiable — jamais une capacité générique
 * "search" quand l'une de celles-ci est connue et vraie.
 */
export type EvidenceType =
  | "activeListings"
  | "soldTransactions"
  | "retailPrices"
  | "historicalPrices"
  | "bidAsk"
  | "productDetails"
  | "barcodeLookup"
  | "search";

export const ALL_EVIDENCE_TYPES: readonly EvidenceType[] = [
  "activeListings",
  "soldTransactions",
  "retailPrices",
  "historicalPrices",
  "bidAsk",
  "productDetails",
  "barcodeLookup",
  "search",
];

/**
 * Déclaration honnête des capacités d'une source — un tableau de
 * `EvidenceType`, jamais devinées : une source qui ne peut confirmer que
 * des annonces actives ne déclare jamais `soldTransactions`, même si son
 * nom marketing suggère "prix de vente".
 */
export interface EvidenceCapabilities {
  readonly evidenceTypes: readonly EvidenceType[];
}

export function declaresEvidenceType(source: EvidenceCapabilities, type: EvidenceType): boolean {
  return source.evidenceTypes.includes(type);
}
