/**
 * Filtres de qualité d'annonce (LOT "Données marché réelles + préparation
 * E2E") — détectent, par le TITRE seul (aucune autre donnée fiable
 * disponible pour une annonce active non détaillée, voir
 * `gather-active-listing-evidence.ts`), les annonces qui ne représentent
 * PAS l'objet complet et unique recherché : lots/bundles, pièces
 * détachées/non fonctionnelles, accessoires seuls, boîte/coque vide.
 *
 * Volontairement une HEURISTIQUE, jamais une certitude : un titre peut
 * échapper à ces motifs (faux négatif) ou, plus rarement, les contenir sans
 * que l'annonce soit réellement incomplète (faux positif, ex. "bundle
 * inclus" dans une description marketing). Documenté honnêtement plutôt que
 * présenté comme une détection fiable à 100 %.
 */

const BUNDLE_OR_PARTS_PATTERNS: readonly RegExp[] = [
  /\bbundle\b/i,
  /\blot of\b/i,
  /\bjob lot\b/i,
  /\bfor parts\b/i,
  /\bnot working\b/i,
  /\bspares?\s*(or|\/)\s*repairs?\b/i,
  /\baccessories?\s+only\b/i,
  /\bcase\s+only\b/i,
  /\bbox\s+only\b/i,
  /\bempty\s+box\b/i,
  /\bshell\s+only\b/i,
  /\bparts?\s+only\b/i,
  /\bbroken\b/i,
  /\bincomplete\b/i,
];

/**
 * `true` si le titre suggère un lot, un bundle, des pièces détachées ou un
 * accessoire seul plutôt que l'objet complet unique — ces annonces ne
 * doivent jamais servir de comparable pour estimer la valeur d'un objet
 * complet fonctionnel. Jamais utilisée seule pour rejeter une catégorie
 * dont l'objet recherché EST un lot/bundle (aucune catégorie DealRadar
 * aujourd'hui ne recherche explicitement des lots — si ce cas apparaît un
 * jour, ce filtre devra devenir conditionnel au profil, pas avant).
 */
export function isLikelyBundleOrPartsListing(title: string): boolean {
  return BUNDLE_OR_PARTS_PATTERNS.some((pattern) => pattern.test(title));
}
