import type { NormalizedListing, NormalizedComparable, StructuredIdentity } from "./types";
import { partitionOutliers } from "./stats";
import { isLikelyBundleOrPartsListing } from "./listing-quality";

/** Compare deux valeurs d'attribut en tolérant la casse/les espaces pour les chaînes (LOT "Données marché réelles") — un nombre reste comparé tel quel, jamais converti en texte. Corrige une incohérence réelle entre sources (ex. un extracteur IA qui produit "iPhone 14 Pro" quand un connecteur normalise en "iphone 14 pro"). */
function attributesMatch(a: string | number | boolean, b: string | number | boolean): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/**
 * Filtre le pool de candidats vers ceux réellement comparables :
 *  1. filtres structurels globaux (catégorie, devise, condition, jamais un
 *     lot/bundle/pièces détachées quand l'objet complet est recherché — voir
 *     `listing-quality.ts`) — jamais mélanger des devises ou des états
 *     différents dans une estimation ;
 *  2. critères de similarité propres au profil de catégorie (ex. numéro de
 *     set LEGO, monture d'objectif) — exact match (insensible à la casse
 *     pour le texte), pas de correspondance floue/partielle.
 * Sans profil résolu, seuls les filtres structurels s'appliquent.
 *
 * Une clé de similarité n'exclut un candidat QUE si les deux côtés portent
 * une valeur ET qu'elles diffèrent (LOT "Données marché réelles" — avant ce
 * lot, une valeur simplement ABSENTE d'un côté excluait aussi, ce qui
 * empêchait structurellement toute annonce eBay obtenue via `search()`
 * — sans détail d'article, donc sans `attributes` — de jamais correspondre
 * à quoi que ce soit au-delà des filtres structurels). Une VRAIE
 * incompatibilité (les deux côtés renseignés, valeurs différentes — ex.
 * 128 Go vs 256 Go) reste une exclusion stricte, jamais une simple pénalité
 * de score : deux variantes différentes ne sont jamais interchangeables
 * pour une estimation de prix.
 */
export function matchComparables(
  listing: NormalizedListing,
  identity: StructuredIdentity,
  candidates: NormalizedComparable[],
): NormalizedComparable[] {
  return candidates.filter((candidate) => {
    if (candidate.categorySlug !== listing.categorySlug) return false;
    if (candidate.currency !== listing.currency) return false;
    if (candidate.condition !== listing.condition) return false;
    if (isLikelyBundleOrPartsListing(candidate.title)) return false;

    if (!identity.profile) return true;

    return identity.profile.similarityAttributeKeys.every((key) => {
      const listingValue = listing.attributes[key];
      const candidateValue = candidate.attributes[key];
      if (listingValue === undefined || candidateValue === undefined) return true;
      return attributesMatch(listingValue, candidateValue);
    });
  });
}

/** Seuls les prix de vente confirmés servent à l'estimation (ADR 0007). */
export function selectSoldComparables(matched: NormalizedComparable[]): NormalizedComparable[] {
  return matched.filter((c) => c.soldAt !== null);
}

/**
 * Annonces actives (prix demandé, jamais confirmé) — repli utilisé
 * uniquement quand aucune vente confirmée n'est disponible (LOT "Universal
 * Object Valuation Foundation", voir `pipeline.ts`). Jamais mélangées aux
 * ventes confirmées dans la même estimation.
 */
export function selectActiveComparables(matched: NormalizedComparable[]): NormalizedComparable[] {
  return matched.filter((c) => c.soldAt === null);
}

export function removeOutliers(
  soldComparables: NormalizedComparable[],
): { used: NormalizedComparable[]; excluded: NormalizedComparable[] } {
  const { kept, excluded } = partitionOutliers(soldComparables, (c) => c.priceCents);
  return { used: kept, excluded };
}
