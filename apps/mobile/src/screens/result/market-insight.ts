import type { MarketEvidence } from "@dealradar/contracts";
import type { ResultMarketInsight } from "./result-view-model";

/**
 * Construction PARTAGÉE de `ResultMarketInsight` — LOT "Product History UX
 * + Source Health + Interactive Cancellation + Beta Readiness", section 1 :
 * extrait de `from-analysis-result-view-model.ts` pour que
 * `from-raf-analysis-view-model.ts` (le mapper RÉELLEMENT utilisé par
 * `UniversalScanScreen.tsx`, voir son en-tête) puisse peupler
 * `marketInsight`/`productKey` avec EXACTEMENT la même traduction que le
 * chemin `AnalysisResult` direct — jamais deux définitions divergentes des
 * mêmes libellés français.
 *
 * Trouvaille de l'audit beta-readiness (section 12) : `generic-object-
 * adapter.ts` appelle bien le pipeline serveur réel (`createAnalysis`/
 * `pollAnalysisUntilSettled`) et reçoit un `AnalysisResult` complet, mais
 * l'aplatissait en `RafAnalysis` SANS jamais reporter `productKey`/
 * `marketEvidence` — `MarketInsightCard` (LOT précédent) n'était donc
 * JAMAIS atteignable par le VRAI flux de scan générique. Corrigé en
 * étendant `RafAnalysis` (voir `identification/types.ts`) pour porter ces
 * deux champs TELS QUELS, jamais recalculés côté mobile.
 */

const QUALITY_FLAG_LABELS: Record<string, string> = {
  variant_conflict_filtered: "Certaines annonces ne correspondaient pas exactement (écartées)",
  stale_evidence: "Données de marché un peu anciennes",
  retail_only: "Basé uniquement sur des prix neufs en boutique",
  active_only: "Basé sur des annonces en cours, aucune vente confirmée",
  low_source_diversity: "Peu de sources différentes consultées",
  high_dispersion: "Les prix varient beaucoup d'une source à l'autre",
  missing_condition: "État non précisé pour certaines annonces",
  fx_partial: "Conversion de devise partiellement fiable",
  weak_identity: "Identification du produit encore incertaine",
  duplicated_origin_merged: "Annonces en double regroupées",
  specialist_only: "Basé uniquement sur un historique spécialisé",
  sparse_history: "Peu d'historique de prix disponible",
};

/** Copie minimale, PUREMENT pour l'affichage, de `EVIDENCE_TIER_LABELS` (`@dealradar/connectors`) — mobile ne dépend jamais de `@dealradar/connectors`. Jamais "Tier A/B/C/D/E" affiché. */
const EVIDENCE_TIER_LABELS: Record<string, string> = {
  A: "Vente confirmée",
  B: "Historique spécialisé",
  C: "Marché en direct (achat/vente)",
  D: "Annonce en cours",
  E: "Prix neuf affiché",
};

/** Décrit un comportement RÉCENT déjà observé, jamais une prédiction ("tendance récente à la hausse", jamais "va monter"/"va baisser"). */
const TREND_LABELS: Record<string, string> = {
  up: "Tendance récente à la hausse",
  down: "Tendance récente à la baisse",
  flat: "Tendance récente stable",
  insufficient: "Historique insuffisant pour une tendance",
};

/** Jamais le mot "percentile" affiché à l'utilisateur (jargon statistique). Seuils volontairement larges (20/80) : jamais une fausse précision sur une position statistique approximative. */
function describeHistoryPosition(percentile: number): string {
  if (percentile <= 20) return "Ce prix se situe parmi les plus bas observés historiquement";
  if (percentile >= 80) return "Ce prix se situe parmi les plus élevés observés historiquement";
  return "Ce prix se situe dans la moyenne de l'historique connu";
}

export interface BuildMarketInsightInput {
  evidence: MarketEvidence | undefined;
  /** Fourchette DÉJÀ arrondie en CENTIMES par l'appelant (jamais recalculée ici) — évite de dupliquer la conversion `amount * 100` entre les deux mappers. */
  fairValueLowCents: number | null;
  fairValueHighCents: number | null;
  currency: string | null;
  confidencePercent: number | null;
}

/**
 * `null` si `evidence` est absent (résultat produit avant l'enrichissement
 * multi-source, ou chemin qui n'en a jamais eu besoin) — jamais un résumé
 * inventé à partir de champs partiels.
 */
export function buildMarketInsight(input: BuildMarketInsightInput): ResultMarketInsight | null {
  const evidence = input.evidence;
  if (!evidence) return null;
  const qualityReasons = (evidence.qualityFlags ?? [])
    .map((flag) => QUALITY_FLAG_LABELS[flag] ?? flag)
    .filter((label, index, all) => all.indexOf(label) === index);
  return {
    fairValueLowCents: input.fairValueLowCents,
    fairValueHighCents: input.fairValueHighCents,
    currency: input.currency,
    confidencePercent: input.confidencePercent,
    sourceCount: evidence.sourceCount,
    strongestEvidenceTier: evidence.strongestTier,
    strongestEvidenceLabel: evidence.strongestTier ? (EVIDENCE_TIER_LABELS[evidence.strongestTier] ?? evidence.strongestTier) : null,
    trendDescriptor: evidence.trendDescriptor ?? null,
    trendLabel: evidence.trendDescriptor ? (TREND_LABELS[evidence.trendDescriptor] ?? evidence.trendDescriptor) : null,
    trendConfidence: evidence.trendConfidence ?? null,
    retailOnlyWarning: evidence.retailOnlyWarning,
    activeListingOnlyWarning: evidence.activeListingsOnlyWarning,
    currentVsHistoryPercentile: evidence.currentVsHistoryPercentile ?? null,
    currentVsHistoryLabel: evidence.currentVsHistoryPercentile !== undefined && evidence.currentVsHistoryPercentile !== null ? describeHistoryPosition(evidence.currentVsHistoryPercentile) : null,
    qualityReasons,
  };
}
