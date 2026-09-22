import type { IdentityQuality } from "@dealradar/contracts";

/**
 * Traduction d'affichage de `AnalysisResult.identityQuality` (LOT "Live
 * Identity Enrichment + Barcode-First + upc.dev Fallback + Railway
 * Readiness", section 12) — un mapper PUR, jamais un composant : le brief
 * demande explicitement de préparer AU MINIMUM un modèle/contrat côté
 * mobile sans nécessairement câbler un composant visuel invasif ce lot
 * (voir `ResultViewModel.identityQualityLabel`, `result-view-model.ts`).
 *
 * `IdentityQuality["method"]` (`@dealradar/contracts`) ne porte QUE 3
 * valeurs réelles aujourd'hui — jamais un 4e libellé "référence
 * constructeur confirmée" inventé ici tant qu'`enrichProductIdentity`
 * (`@dealradar/ingestion`) ne produit pas de `qualityMethod` correspondant
 * (seuls `barcode_confirmed`/`lego_catalog_confirmed`/`visual_only`
 * existent, voir `packages/ingestion/src/enrich-product-identity.ts`).
 */
const IDENTITY_QUALITY_METHOD_LABELS: Record<IdentityQuality["method"], string> = {
  barcode_confirmed: "Identifié par code-barres",
  lego_catalog_confirmed: "Catalogue LEGO confirmé",
  visual_only: "Identification visuelle seulement",
};

/** `null` = `identityQuality` absent (résultat produit avant ce lot, ou verticale TCG qui n'utilise jamais ce champ) — jamais un libellé deviné pour un résultat qui n'a pas réellement tenté d'enrichissement catalogue. */
export function identityQualityLabel(identityQuality: IdentityQuality | undefined): string | null {
  if (!identityQuality) return null;
  return IDENTITY_QUALITY_METHOD_LABELS[identityQuality.method] ?? null;
}
