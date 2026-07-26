import type { NormalizedListing, StructuredIdentity } from "./types";
import { resolveCategoryProfile } from "./category-profiles";

/**
 * Résout le profil de catégorie de l'annonce et évalue son identification :
 * champs obligatoires manquants, signaux de risque déclenchés. Une catégorie
 * inconnue (hors des 5 profils) produit une identité sans profil — le reste
 * du pipeline la traite comme une donnée d'entrée pauvre, pas comme une erreur.
 */
export function identifyListing(listing: NormalizedListing): StructuredIdentity {
  const profile = resolveCategoryProfile(listing.categorySlug) ?? null;

  const missingRequiredFields = profile
    ? profile.requiredAttributeKeys.filter((key) => !(key in listing.attributes))
    : [];

  const matchedRiskSignals = profile ? profile.riskSignals.filter((signal) => signal.test(listing)) : [];

  return {
    categorySlug: listing.categorySlug,
    profile,
    missingRequiredFields,
    matchedRiskSignals,
  };
}
