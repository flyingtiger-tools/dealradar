import { formatMoneyRange } from "./money";

/**
 * Texte de partage centralisé (LOT "beta product readiness", Phase 24/25)
 * — jamais construit inline dans un bouton. Aucune donnée inventée : si
 * `marketValue` est `null` (carte identifiée sans prix), la ligne de prix
 * est simplement omise, jamais un prix fictif ni un "indisponible" qui
 * alourdirait le texte de partage sans utilité.
 */
export interface ShareableResult {
  productName: string | null;
  setName: string | null;
  collectorNumber: string | null;
  marketValue: { low: number; high: number; currency: string } | null;
}

export function buildResultShareText(result: ShareableResult): string {
  const titleParts = [result.productName, result.setName, result.collectorNumber ? `#${result.collectorNumber}` : null].filter(Boolean);
  const lines = [titleParts.join(" — ") || "Produit identifié"];

  if (result.marketValue) {
    lines.push(`Valeur marché : ${formatMoneyRange(result.marketValue.low, result.marketValue.high, result.marketValue.currency)}`);
  }

  lines.push("Analyse DealRadar");
  return lines.join("\n");
}
