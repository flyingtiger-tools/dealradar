import type { NormalizedComparable, NetProfitResult, StructuredIdentity } from "./types";
import { clamp } from "./stats";

const RECENT_SALE_WINDOW_DAYS = 90;

/** Score 0–100 : centré sur une marge nulle, ±1 point par point de marge (%). */
export function computeDealScore(netProfit: NetProfitResult | null): number {
  if (!netProfit) return 0;
  return clamp(Math.round(50 + netProfit.marginRatio * 100), 0, 100);
}

/**
 * Score 0–100 reflétant la fiabilité des données, pas la qualité de l'affaire :
 * plus de comparables vendus, moins de champs manquants, moins de signaux de
 * risque déclenchés et un écart de prix resserré augmentent la confiance.
 */
export function computeConfidenceScore(
  identity: StructuredIdentity,
  soldComparablesCount: number,
  priceSpreadRatio: number | null,
): number {
  let score = 50;
  score += Math.min(soldComparablesCount, 10) * 4;
  score -= identity.missingRequiredFields.length * (identity.profile?.confidencePenaltyPerMissingField ?? 15);
  score -= identity.matchedRiskSignals.reduce((sum, signal) => sum + signal.penalty, 0);
  if (!identity.profile) score -= 20;
  if (priceSpreadRatio !== null) score -= Math.round(priceSpreadRatio * 20);
  return clamp(score, 0, 100);
}

/**
 * Score 0–100 : volume de ventes confirmées (jusqu'à 10, plafonné) + part de
 * ventes récentes (fenêtre de 90 jours depuis `asOf`, explicite — déterministe).
 */
export function computeLiquidityScore(soldComparables: NormalizedComparable[], asOf: string): number {
  if (soldComparables.length === 0) return 0;

  const asOfMs = Date.parse(asOf);
  const windowMs = RECENT_SALE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentCount = soldComparables.filter(
    (c) => c.soldAt !== null && asOfMs - Date.parse(c.soldAt) <= windowMs,
  ).length;

  const volumeComponent = Math.min(soldComparables.length, 10) * 6;
  const recencyComponent = Math.round((recentCount / soldComparables.length) * 40);
  return clamp(volumeComponent + recencyComponent, 0, 100);
}
