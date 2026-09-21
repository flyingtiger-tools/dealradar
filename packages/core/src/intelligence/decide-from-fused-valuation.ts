import { decide, MIN_SOLD_COMPARABLES_FOR_ANY_DECISION, DEFAULT_MIN_SOLD_COMPARABLES_FOR_STRONG_RECOMMENDATION, CONFIDENCE_FLOOR } from "./decision";
import type { DecisionOutput } from "./decision";
import type { FusedValuation } from "./fuse-market-observations";

/**
 * Adapte `FusedValuation` (`fuse-market-observations.ts`) vers le moteur de
 * décision EXISTANT (`decision.ts`, ADR 0007) — SANS jamais lui faire
 * croire qu'une preuve de palier C/D/E (bid/ask, annonce active, prix
 * neuf affiché) est l'équivalent d'un comparable VENDU confirmé
 * (`decide()` a été calibré sur cette hypothèse précise, voir ses seuils).
 *
 * Règle explicite (héritée du lot précédent, section 5, jamais assouplie
 * ce lot) : "no BUY recommendation logic here unless the existing decision
 * engine can consume the result without semantic regression." Réutiliser
 * `decide()` n'est donc "semantically safe" QUE lorsque le palier le plus
 * fort est A ou B (vente confirmée ou marché spécialisé calculé) — dans ce
 * cas seulement, le nombre d'observations de CE palier haute qualité tient
 * lieu de `soldComparablesCount`. Pour C/D/E, jamais de BUY/PASS automatique
 * depuis la fusion seule : au mieux REVIEW (preuve présente mais trop
 * faible pour statuer sans revue humaine), ou INSUFFICIENT_DATA si la
 * confiance est sous le plancher existant.
 */
export function decideFromFusedValuation(fused: FusedValuation, dealScore: number | null): DecisionOutput {
  if (fused.status === "insufficient" || !fused.strongestTier) {
    return {
      decision: "INSUFFICIENT_DATA",
      reason: fused.reasons[0] ?? "Preuve de marché insuffisante pour statuer.",
    };
  }

  const isHighQualityTier = fused.strongestTier === "A" || fused.strongestTier === "B";

  if (isHighQualityTier) {
    const highQualityCount = fused.evidenceMix.filter((e) => e.tier === "A" || e.tier === "B").reduce((sum, e) => sum + e.count, 0);
    return decide({
      soldComparablesCount: highQualityCount,
      dealScore,
      confidenceScore: fused.confidence,
      minSoldComparablesForStrongRecommendation: DEFAULT_MIN_SOLD_COMPARABLES_FOR_STRONG_RECOMMENDATION,
    });
  }

  // Palier C/D/E : jamais BUY/PASS depuis la fusion seule (voir l'en-tête).
  if (fused.confidence < CONFIDENCE_FLOOR) {
    return {
      decision: "INSUFFICIENT_DATA",
      reason: `Preuve de marché disponible (palier ${fused.strongestTier}) mais confiance trop faible (${fused.confidence}/100) pour statuer.`,
    };
  }
  return {
    decision: "REVIEW",
    reason: `Preuve de marché disponible (palier ${fused.strongestTier}, confiance ${fused.confidence}/100) mais pas assez fiable (annonce active/prix affiché, jamais une vente confirmée) pour une recommandation BUY/PASS automatique — au moins ${MIN_SOLD_COMPARABLES_FOR_ANY_DECISION} vente(s) confirmée(s) seraient nécessaires pour cela.`,
  };
}
