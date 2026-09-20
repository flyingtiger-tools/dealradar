import type { IntelligencePipelineInput, IntelligencePipelineResult, NormalizedComparable, PriceEstimate } from "./types";
import { identifyListing } from "./identify";
import { matchComparables, selectSoldComparables, selectActiveComparables, removeOutliers } from "./comparables";
import { estimatePrice } from "./estimate";
import { computeNetProfit } from "./profit";
import { computeDealScore, computeConfidenceScore, computeLiquidityScore } from "./scores";
import { decide, DEFAULT_MIN_SOLD_COMPARABLES_FOR_STRONG_RECOMMENDATION, MIN_SOLD_COMPARABLES_FOR_ANY_DECISION } from "./decision";
import { buildWhyPanel } from "./why-panel";
import { clamp } from "./stats";

/**
 * Plafond de confiance quand l'estimation repose uniquement sur des annonces
 * actives (prix demandé, jamais confirmé) — LOT "Universal Object Valuation
 * Foundation". Fixé nettement sous `STRONG_CONFIDENCE_THRESHOLD` (60,
 * `decision.ts`) : une preuve d'annonces actives, aussi nombreuse soit-elle,
 * ne doit JAMAIS pouvoir à elle seule franchir le seuil BUY — seule une
 * vente réellement confirmée le peut. Documenté et testé explicitement
 * (`pipeline.test.ts`), pas un effet de bord accidentel du calcul de score.
 */
export const ACTIVE_LISTING_CONFIDENCE_CAP = 55;

/**
 * Orchestrateur unique du cœur d'intelligence : normalisation → identification
 * → comparables → filtrage → estimation → profit net → scores → décision →
 * explication. Fonction pure : aucune I/O, entièrement déterminée par `input`
 * (y compris `asOf`, jamais l'horloge système).
 *
 * Repli sur annonces actives (LOT "Universal Object Valuation Foundation") :
 * quand aucune vente confirmée n'est disponible mais que des annonces
 * actives correspondent, l'estimation les utilise à la place plutôt que de
 * systématiquement renvoyer `INSUFFICIENT_DATA` — mais seulement si le
 * volume passe le même plancher que pour les ventes
 * (`MIN_SOLD_COMPARABLES_FOR_ANY_DECISION`), et toujours avec une confiance
 * plafonnée (`ACTIVE_LISTING_CONFIDENCE_CAP`). Comportement des ventes
 * confirmées strictement inchangé : ce repli ne s'active JAMAIS quand au
 * moins une vente confirmée exploitable existe.
 */
export function runIntelligencePipeline(input: IntelligencePipelineInput): IntelligencePipelineResult {
  const identity = identifyListing(input.listing);

  const matched = matchComparables(input.listing, identity, input.candidates);
  const soldMatched = selectSoldComparables(matched);
  const { used, excluded } = removeOutliers(soldMatched);

  const activeMatched = selectActiveComparables(matched);
  const { used: usedActive, excluded: excludedActive } = removeOutliers(activeMatched);

  const usingActiveTier = used.length === 0 && usedActive.length >= MIN_SOLD_COMPARABLES_FOR_ANY_DECISION;
  const evidenceComparables: NormalizedComparable[] = usingActiveTier ? usedActive : used;

  const rawEstimate = estimatePrice(evidenceComparables);
  const estimate: PriceEstimate | null = rawEstimate
    ? { ...rawEstimate, evidenceTier: usingActiveTier ? "active_listing" : "sold" }
    : null;
  const netProfit = estimate ? computeNetProfit(estimate, input.costs) : null;

  const priceSpreadRatio =
    estimate && estimate.medianCents > 0 ? (estimate.p75Cents - estimate.p25Cents) / estimate.medianCents : null;

  const dealScore = netProfit ? computeDealScore(netProfit) : null;
  let confidenceScore = computeConfidenceScore(identity, evidenceComparables.length, priceSpreadRatio);
  if (usingActiveTier) confidenceScore = clamp(confidenceScore, 0, ACTIVE_LISTING_CONFIDENCE_CAP);
  const liquidityScore = computeLiquidityScore(evidenceComparables, input.asOf);

  const { decision, reason } = decide({
    soldComparablesCount: evidenceComparables.length,
    dealScore,
    confidenceScore,
    minSoldComparablesForStrongRecommendation:
      identity.profile?.minSoldComparablesForStrongRecommendation ??
      DEFAULT_MIN_SOLD_COMPARABLES_FOR_STRONG_RECOMMENDATION,
  });

  const scores = { deal: dealScore, confidence: confidenceScore, liquidity: liquidityScore };

  const whyPanel = buildWhyPanel({
    identity,
    usedComparables: evidenceComparables,
    excludedOutliers: usingActiveTier ? excludedActive : excluded,
    estimate,
    netProfit,
    scores,
    decision,
    reason,
    evidenceTier: usingActiveTier ? "active_listing" : "sold",
  });

  return {
    identity,
    comparables: { matched, used, excludedOutliers: excluded },
    activeComparables: { matched: activeMatched, used: usedActive, excludedOutliers: excludedActive },
    estimate,
    netProfit,
    scores,
    decision,
    whyPanel,
  };
}
