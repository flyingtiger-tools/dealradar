import type {
  StructuredIdentity,
  NormalizedComparable,
  PriceEstimate,
  NetProfitResult,
  IntelligenceScores,
  Decision,
  WhyPanel,
  WhyFactor,
} from "./types";

export interface WhyPanelInput {
  identity: StructuredIdentity;
  usedComparables: NormalizedComparable[];
  excludedOutliers: NormalizedComparable[];
  estimate: PriceEstimate | null;
  netProfit: NetProfitResult | null;
  scores: IntelligenceScores;
  decision: Decision;
  reason: string;
}

/** Traduit chaque étape du pipeline en facteurs positifs/négatifs lisibles. */
export function buildWhyPanel(input: WhyPanelInput): WhyPanel {
  const { identity, usedComparables, excludedOutliers, estimate, netProfit, scores, decision, reason } = input;
  const factors: WhyFactor[] = [];

  factors.push({
    id: "sold_comparables",
    label: "Comparables vendus",
    direction: usedComparables.length >= 5 ? "positive" : usedComparables.length >= 3 ? "neutral" : "negative",
    detail:
      excludedOutliers.length > 0
        ? `${usedComparables.length} vente(s) confirmée(s) retenue(s), ${excludedOutliers.length} écartée(s) comme valeur(s) aberrante(s).`
        : `${usedComparables.length} vente(s) confirmée(s) retenue(s).`,
  });

  if (!identity.profile) {
    factors.push({
      id: "unknown_category",
      label: "Catégorie non couverte par un profil",
      direction: "negative",
      detail: `Aucun profil déclaratif pour « ${identity.categorySlug} » — identification et similarité réduites au minimum.`,
    });
  }

  if (identity.missingRequiredFields.length > 0) {
    factors.push({
      id: "missing_fields",
      label: "Champs d'identification manquants",
      direction: "negative",
      detail: identity.missingRequiredFields.join(", "),
    });
  }

  for (const signal of identity.matchedRiskSignals) {
    factors.push({
      id: `risk_${signal.id}`,
      label: signal.description,
      direction: "negative",
      detail: `Pénalité de ${signal.penalty} point(s) sur la confiance.`,
    });
  }

  if (netProfit) {
    factors.push({
      id: "net_profit",
      label: "Profit net estimé",
      direction: netProfit.netProfitCents > 0 ? "positive" : "negative",
      detail: `${netProfit.netProfitCents} centimes (marge ${(netProfit.marginRatio * 100).toFixed(1)} %) après achat, livraison, frais de plateforme, réserve de risque et éventuelle remise en état.`,
    });
  }

  if (estimate) {
    factors.push({
      id: "estimate_spread",
      label: "Dispersion des prix observés",
      direction: "neutral",
      detail: `Médiane ${estimate.medianCents}, entre ${estimate.p25Cents} (p25) et ${estimate.p75Cents} (p75), sur ${estimate.sampleSize} vente(s).`,
    });
  }

  factors.push({
    id: "liquidity",
    label: "Liquidité",
    direction: scores.liquidity >= 60 ? "positive" : scores.liquidity <= 30 ? "negative" : "neutral",
    detail: `Score de liquidité ${scores.liquidity}/100, basé sur ${usedComparables.length} vente(s) confirmée(s).`,
  });

  return { decision, summary: reason, factors };
}
