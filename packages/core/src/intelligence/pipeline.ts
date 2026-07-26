import type { IntelligencePipelineInput, IntelligencePipelineResult } from "./types";
import { identifyListing } from "./identify";
import { matchComparables, selectSoldComparables, removeOutliers } from "./comparables";
import { estimatePrice } from "./estimate";
import { computeNetProfit } from "./profit";
import { computeDealScore, computeConfidenceScore, computeLiquidityScore } from "./scores";
import { decide, DEFAULT_MIN_SOLD_COMPARABLES_FOR_STRONG_RECOMMENDATION } from "./decision";
import { buildWhyPanel } from "./why-panel";

/**
 * Orchestrateur unique du cœur d'intelligence : normalisation → identification
 * → comparables → filtrage → estimation → profit net → scores → décision →
 * explication. Fonction pure : aucune I/O, entièrement déterminée par `input`
 * (y compris `asOf`, jamais l'horloge système).
 */
export function runIntelligencePipeline(input: IntelligencePipelineInput): IntelligencePipelineResult {
  const identity = identifyListing(input.listing);

  const matched = matchComparables(input.listing, identity, input.candidates);
  const soldMatched = selectSoldComparables(matched);
  const { used, excluded } = removeOutliers(soldMatched);

  const estimate = estimatePrice(used);
  const netProfit = estimate ? computeNetProfit(estimate, input.costs) : null;

  const priceSpreadRatio =
    estimate && estimate.medianCents > 0 ? (estimate.p75Cents - estimate.p25Cents) / estimate.medianCents : null;

  const dealScore = netProfit ? computeDealScore(netProfit) : null;
  const confidenceScore = computeConfidenceScore(identity, used.length, priceSpreadRatio);
  const liquidityScore = computeLiquidityScore(used, input.asOf);

  const { decision, reason } = decide({
    soldComparablesCount: used.length,
    dealScore,
    confidenceScore,
    minSoldComparablesForStrongRecommendation:
      identity.profile?.minSoldComparablesForStrongRecommendation ??
      DEFAULT_MIN_SOLD_COMPARABLES_FOR_STRONG_RECOMMENDATION,
  });

  const scores = { deal: dealScore, confidence: confidenceScore, liquidity: liquidityScore };

  const whyPanel = buildWhyPanel({
    identity,
    usedComparables: used,
    excludedOutliers: excluded,
    estimate,
    netProfit,
    scores,
    decision,
    reason,
  });

  return {
    identity,
    comparables: { matched, used, excludedOutliers: excluded },
    estimate,
    netProfit,
    scores,
    decision,
    whyPanel,
  };
}
