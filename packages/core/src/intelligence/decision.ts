import type { Decision } from "./types";

/**
 * Seuils de décision (ADR 0007). La garde « données insuffisantes » est
 * évaluée en premier, avant même de regarder le Deal Score : aucune
 * recommandation BUY n'est jamais possible sous ce plancher (règle 6).
 */
export const MIN_SOLD_COMPARABLES_FOR_ANY_DECISION = 3;
export const DEFAULT_MIN_SOLD_COMPARABLES_FOR_STRONG_RECOMMENDATION = 5;
export const CONFIDENCE_FLOOR = 40;
export const STRONG_CONFIDENCE_THRESHOLD = 60;
export const BUY_DEAL_SCORE_THRESHOLD = 70;
export const PASS_DEAL_SCORE_THRESHOLD = 35;

export interface DecisionInput {
  soldComparablesCount: number;
  dealScore: number | null;
  confidenceScore: number;
  /** Seuil de comparables requis pour une recommandation BUY — peut être relevé par un profil de catégorie. */
  minSoldComparablesForStrongRecommendation: number;
}

export interface DecisionOutput {
  decision: Decision;
  reason: string;
}

export function decide(input: DecisionInput): DecisionOutput {
  const { soldComparablesCount, dealScore, confidenceScore, minSoldComparablesForStrongRecommendation } = input;

  if (dealScore === null || soldComparablesCount < MIN_SOLD_COMPARABLES_FOR_ANY_DECISION || confidenceScore < CONFIDENCE_FLOOR) {
    return {
      decision: "INSUFFICIENT_DATA",
      reason: `Seulement ${soldComparablesCount} comparable(s) vendu(s) exploitable(s) et/ou confiance trop faible (${confidenceScore}/100) pour statuer.`,
    };
  }

  if (dealScore >= BUY_DEAL_SCORE_THRESHOLD) {
    if (soldComparablesCount >= minSoldComparablesForStrongRecommendation && confidenceScore >= STRONG_CONFIDENCE_THRESHOLD) {
      return {
        decision: "BUY",
        reason: `Marge nette élevée (score ${dealScore}/100) confirmée par ${soldComparablesCount} comparables vendus et une confiance de ${confidenceScore}/100.`,
      };
    }
    return {
      decision: "REVIEW",
      reason: `Marge nette prometteuse (score ${dealScore}/100) mais échantillon (${soldComparablesCount}) ou confiance (${confidenceScore}/100) insuffisants pour une recommandation forte.`,
    };
  }

  if (dealScore <= PASS_DEAL_SCORE_THRESHOLD) {
    return { decision: "PASS", reason: `Marge nette insuffisante (score ${dealScore}/100).` };
  }

  return { decision: "REVIEW", reason: `Opportunité moyenne (score ${dealScore}/100) — à examiner manuellement.` };
}
