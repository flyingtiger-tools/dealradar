/**
 * Champs réellement requis pour l'**identification** d'un produit, par
 * catégorie — déclaratif, jamais une règle générique "brand+model+condition".
 * `condition` n'est jamais un champ d'identification : LEGO peut être
 * identifié par le seul `setNumber`, même si l'état est inconnu.
 *
 * Important : les clés `attributeKeys` sont volontairement identiques à
 * `CategoryProfile.requiredAttributeKeys`/`similarityAttributeKeys` de
 * `@dealradar/core` (packages/core/src/intelligence/category-profiles.ts)
 * — une extraction qui remplit ces clés est directement exploitable par le
 * filtre d'identité d'`analyze-listing.ts` (Lot 4), sans mapping supplémentaire.
 */
export interface ExtractionRequirementProfile {
  /** Clés de `ExtractedProduct.attributes` requises pour considérer l'identification suffisante. */
  attributeKeys: string[];
  /** Seuil de confiance minimal, par clé, en dessous duquel le champ compte comme manquant. */
  minConfidence: number;
}

export const DEFAULT_MIN_CONFIDENCE = 0.85;

export const EXTRACTION_REQUIREMENT_PROFILES: Record<string, ExtractionRequirementProfile> = {
  lego: { attributeKeys: ["setNumber"], minConfidence: DEFAULT_MIN_CONFIDENCE },
  pokemon_tcg: { attributeKeys: ["cardName", "setCode"], minConfidence: DEFAULT_MIN_CONFIDENCE },
  apple: { attributeKeys: ["model", "storageGb"], minConfidence: DEFAULT_MIN_CONFIDENCE },
  gaming: { attributeKeys: ["platform", "productName"], minConfidence: DEFAULT_MIN_CONFIDENCE },
  photo: { attributeKeys: ["gearType", "model"], minConfidence: DEFAULT_MIN_CONFIDENCE },
};

export function resolveRequirementProfile(categorySlug: string): ExtractionRequirementProfile | null {
  return EXTRACTION_REQUIREMENT_PROFILES[categorySlug] ?? null;
}

/**
 * Vrai si `product.attributes` couvre tous les champs requis pour identifier
 * le produit dans cette catégorie, avec une confiance suffisante. Une
 * catégorie non déclarée n'a jamais de raccourci implicite : elle exige
 * systématiquement l'IA (retourne `false`), jamais une supposition.
 */
export function isSufficientForIdentification(
  attributes: Record<string, { value: unknown; confidence: number } | null>,
  categorySlug: string,
): boolean {
  const profile = resolveRequirementProfile(categorySlug);
  if (!profile) return false;
  return profile.attributeKeys.every((key) => {
    const entry = attributes[key];
    return entry !== null && entry !== undefined && entry.confidence >= profile.minConfidence;
  });
}
