import type { NormalizedListing, NormalizedComparable, StructuredIdentity } from "./types";
import { partitionOutliers } from "./stats";

/**
 * Filtre le pool de candidats vers ceux réellement comparables :
 *  1. filtres structurels globaux (catégorie, devise, condition) — jamais
 *     mélanger des devises ou des états différents dans une estimation ;
 *  2. critères de similarité propres au profil de catégorie (ex. numéro de
 *     set LEGO, monture d'objectif) — exact match en V1, pas de flou.
 * Sans profil résolu, seuls les filtres structurels s'appliquent.
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

    if (!identity.profile) return true;

    return identity.profile.similarityAttributeKeys.every((key) => {
      const listingValue = listing.attributes[key];
      const candidateValue = candidate.attributes[key];
      if (listingValue === undefined || candidateValue === undefined) return false;
      return listingValue === candidateValue;
    });
  });
}

/** Seuls les prix de vente confirmés servent à l'estimation (ADR 0007). */
export function selectSoldComparables(matched: NormalizedComparable[]): NormalizedComparable[] {
  return matched.filter((c) => c.soldAt !== null);
}

export function removeOutliers(
  soldComparables: NormalizedComparable[],
): { used: NormalizedComparable[]; excluded: NormalizedComparable[] } {
  const { kept, excluded } = partitionOutliers(soldComparables, (c) => c.priceCents);
  return { used: kept, excluded };
}
