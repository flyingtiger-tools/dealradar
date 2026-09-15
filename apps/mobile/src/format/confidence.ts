/**
 * Normalisation de la confiance (LOT "beta product readiness", Phase 29)
 * — UNE seule représentation UI (0-100, entier) à partir de la valeur
 * 0-1 produite par le pipeline (`TcgCardIdentity.confidence`,
 * `TcgCardExtractedFields.confidence`). Point de conversion UNIQUE :
 * n'importe où ailleurs dans l'app qui affiche une confiance doit passer
 * par cette fonction, jamais un second `Math.round(x * 100)` local — le
 * risque réel visé est une multiplication accidentelle appliquée deux
 * fois (une valeur déjà 0-100 remultipliée par 100).
 */
export function toConfidencePercent(confidence0to1: number): number {
  return Math.round(confidence0to1 * 100);
}
