import type { EvidenceType } from "./evidence-types";

/**
 * Hiérarchie de qualité de preuve (LOT "Multi-Source Market Intelligence
 * Foundation") — séparée du NOM de la source : deux sources différentes
 * fournissant le même `EvidenceType` ont la MÊME fiabilité de principe,
 * jamais une préférence cachée pour une marque particulière. Distincte de
 * `packages/core/src/intelligence/types.ts` `EvidenceTier`
 * (`"sold"|"active_listing"`, 2 paliers, déjà utilisée par le pipeline TCG
 * existant, `pipeline.ts`) — volontairement NON modifiée ce lot (LOT
 * "préserver le comportement TCG existant" : ce fichier introduit le
 * modèle à 5 paliers pour le nouvel agrégateur multi-source, jamais un
 * remplacement rétroactif du pipeline qui fonctionne déjà).
 *
 * A > B > C > D > E, jamais une simple moyenne de tous les prix rassemblés
 * (règle produit explicite de ce lot) — un appelant doit toujours pouvoir
 * pondérer/filtrer par palier avant d'estimer un prix.
 */
export type EvidenceQualityTier = "A" | "B" | "C" | "D" | "E";

export const EVIDENCE_TIER_LABELS: Record<EvidenceQualityTier, string> = {
  A: "Vente confirmée",
  B: "Marché spécialisé (donnée calculée)",
  C: "Marché bid/ask en direct",
  D: "Annonce active",
  E: "Prix neuf affiché",
};

/**
 * Poids d'ordre STRICT — jamais utilisé comme une distance numérique
 * (A n'est pas "5 fois mieux" que E), seulement pour trier/comparer. Voir
 * `compareEvidenceTiers`.
 */
const TIER_ORDER: Record<EvidenceQualityTier, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };

/** > 0 si `a` est une preuve plus forte que `b`, < 0 si plus faible, 0 si égale. */
export function compareEvidenceTiers(a: EvidenceQualityTier, b: EvidenceQualityTier): number {
  return TIER_ORDER[a] - TIER_ORDER[b];
}

export function isStrongerTier(a: EvidenceQualityTier, b: EvidenceQualityTier): boolean {
  return compareEvidenceTiers(a, b) > 0;
}

/**
 * Correspondance par défaut `EvidenceType` -> palier. Un `EvidenceType`
 * seul ne suffit parfois pas (`historicalPrices` peut être du B selon la
 * source) — les connecteurs peuvent surcharger explicitement via
 * `MarketObservation.evidenceTier` plutôt que de dépendre uniquement de
 * cette correspondance par défaut (voir `market-observation.ts`).
 */
export const DEFAULT_EVIDENCE_TYPE_TIER: Record<EvidenceType, EvidenceQualityTier> = {
  soldTransactions: "A",
  historicalPrices: "B",
  bidAsk: "C",
  activeListings: "D",
  retailPrices: "E",
  // Ni une vente, ni un prix — ces deux types ne portent pas de prix en
  // eux-mêmes (détails produit / lookup code-barres) : jamais utilisés
  // pour une estimation, palier le plus faible par défaut plutôt qu'une
  // valeur inventée qui laisserait croire à une preuve de prix.
  productDetails: "E",
  barcodeLookup: "E",
  search: "E",
};

export function defaultTierForEvidenceType(evidenceType: EvidenceType): EvidenceQualityTier {
  return DEFAULT_EVIDENCE_TYPE_TIER[evidenceType];
}
