import type { HistoryIntelligenceV2, FusionHistoryContext } from "@dealradar/core";

/**
 * Compose un `ProductHistoryResult`/`HistoryIntelligenceV2` déjà calculé
 * (`query-product-history.ts`, `@dealradar/core`) en le `FusionHistoryContext`
 * minimal attendu par `fuseMarketObservations` (LOT "Interactive History +
 * Generic Result UI + Full Cancellation + Pre-Prod Activation Package",
 * section 1) — fonction PURE, jamais un second calcul de médiane/tendance,
 * uniquement une projection des champs déjà produits par
 * `computeHistoryIntelligenceV2`.
 *
 * `null` quand `history.sampleSize === 0` — un historique vide n'a rien à
 * offrir à la fusion, jamais un contexte "vide" fabriqué qui pourrait être
 * mal interprété comme "confiance 0 mais présente".
 *
 * `trendDirection` retient la fenêtre la plus COURTE qui produit un signal
 * réel (`direction !== "insufficient"`) parmi 7/30/90/180 jours — privilégie
 * la tendance la plus récente disponible plutôt qu'une fenêtre fixe,
 * jamais une extrapolation au-delà de ce que `history.trends` fournit déjà.
 */
export function toFusionHistoryContext(history: HistoryIntelligenceV2, freshnessHours: number | null): FusionHistoryContext | null {
  if (history.sampleSize === 0) return null;
  const primaryTrend = history.trends.find((t) => t.direction !== "insufficient");
  return {
    historicalMedianCents: history.medianCents,
    freshnessHours,
    trendDirection: primaryTrend?.direction ?? "insufficient",
    confidence: history.confidence,
    sampleSize: history.sampleSize,
  };
}
