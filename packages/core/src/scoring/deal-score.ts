import type { ScoringEngine, ScoringInput, ScoringResult } from "./types";

/**
 * Deal Score v1 — moteur heuristique de référence.
 *
 * Principe : positionner le prix de l'annonce dans la distribution
 * de ses comparables, puis traduire en verdict Acheter / Attendre / Vendre.
 *
 * v1 volontairement simple et explicable ; le module ML (shadow scoring)
 * devra battre cette référence avant toute promotion.
 */
export const dealScoreV1: ScoringEngine = {
  scoreType: "deal",
  version: "deal_v1",

  compute({ listing, comparables }: ScoringInput): ScoringResult {
    const prices = comparables.members
      .map((m) => m.priceCents)
      .sort((a, b) => a - b);

    if (prices.length < 3) {
      return {
        value: 50,
        verdict: "wait",
        explanation: {
          reason: "insufficient_comparables",
          sampleSize: prices.length,
        },
      };
    }

    const median = percentile(prices, 0.5);
    const p25 = percentile(prices, 0.25);
    const p75 = percentile(prices, 0.75);

    // Position relative : 0 = très en dessous du marché, 1 = très au-dessus
    const spread = Math.max(p75 - p25, 1);
    const position = (listing.priceCents - median) / spread;

    // Score 0–100 : 100 = opportunité maximale
    const value = clamp(Math.round(50 - position * 40), 0, 100);

    const verdict = value >= 70 ? "buy" : value <= 30 ? "sell" : "wait";

    return {
      value,
      verdict,
      explanation: {
        medianCents: median,
        p25Cents: p25,
        p75Cents: p75,
        sampleSize: prices.length,
        relativePosition: Number(position.toFixed(3)),
      },
    };
  },
};

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return Math.round(a + (b - a) * (idx - lo));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
