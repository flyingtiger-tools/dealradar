import type { NormalizedComparable, PriceEstimate } from "./types";
import { median, percentile } from "./stats";

/**
 * Estimation prudente : médiane + quartiles sur les comparables vendus déjà
 * filtrés (valeurs aberrantes retirées en amont). `conservativeCents` = p25 —
 * 75 % des ventes observées se sont faites à ce prix ou au-dessus, un ancrage
 * délibérément bas pour éviter la fausse précision en aval (profit net).
 */
export function estimatePrice(soldComparables: NormalizedComparable[]): PriceEstimate | null {
  if (soldComparables.length === 0) return null;

  const sortedPrices = soldComparables.map((c) => c.priceCents).sort((a, b) => a - b);

  return {
    sampleSize: sortedPrices.length,
    medianCents: Math.round(median(sortedPrices)),
    p25Cents: Math.round(percentile(sortedPrices, 0.25)),
    p75Cents: Math.round(percentile(sortedPrices, 0.75)),
    conservativeCents: Math.round(percentile(sortedPrices, 0.25)),
  };
}
