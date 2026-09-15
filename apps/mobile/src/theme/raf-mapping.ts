import type { RafAnalysisStatus } from "../identification/types";

/**
 * Source de vérité UNIQUE pour "quel état Raf pour quelle situation"
 * (Phase 10, LOT "fondation produit Raf") — jamais dupliqué dans un écran.
 * Tout écran qui doit choisir un visuel Raf importe une fonction d'ici,
 * jamais une correspondance recopiée localement.
 *
 * Deux familles de situations, réellement distinctes dans le pipeline :
 *
 * 1. Statut d'identification (`RafAnalysisStatus`, `identification/types.ts`)
 *    — TOUJOURS disponible, c'est ce que le scan Pokémon produit aujourd'hui
 *    (`RafAnalysis.status` / `TcgCardAnalysisResult`).
 * 2. Palier de "deal" (`DealTier`) — dérivé de `decision`
 *    (`@dealradar/contracts` `analysisDecisionSchema` : "BUY"/"REVIEW"/
 *    "PASS"/"INSUFFICIENT_DATA", lui-même produit par
 *    `runIntelligencePipeline()` côté `@dealradar/core`) + `dealScore`
 *    (0-100, même échelle que `computeDealScore`). Ce chemin N'EST PAS
 *    encore atteint par le scan carte TCG aujourd'hui (`RafAnalysis.decision`
 *    reste `null` pour cette catégorie, voir `identification/types.ts`) —
 *    il existe pour le futur flux générique (`AnalysisResult`, déjà dans le
 *    contrat `@dealradar/contracts`) sans qu'aucune nouvelle logique de
 *    décision ne soit inventée ici : ce fichier ne fait QUE choisir un
 *    visuel à partir d'une décision déjà prise côté serveur, jamais
 *    l'inverse.
 */

export type RafState =
  | "neutral"
  | "happy"
  | "clever"
  | "thinking"
  | "analyzing"
  | "searching"
  | "scanning"
  | "warning"
  | "badDeal"
  | "goodDeal"
  | "gem"
  | "megaDeal"
  // États étendus (LOT "package visuel Raf", Phase 5, demandés explicitement
  // par l'utilisateur — pas dérivés des source_boards/, jugés non fiables
  // pour ce lot, voir docs/raf-asset-status.md) : "comparing"/"notifying"
  // complètent les phases d'action déjà couvertes par analyzing/searching/
  // scanning ; les 3 "empty*" couvrent des cas d'absence de données
  // distincts de "warning" (réservé à un problème sur un résultat déjà
  // obtenu). Optionnels : aucun écran n'est obligé de les utiliser, ajoutés
  // seulement là où ils clarifient réellement l'intention.
  | "comparing"
  | "notifying"
  | "emptySearch"
  | "emptyNoResults"
  | "emptyError";

/** Tous les états Raf valides — utilisé par le registry pour valider les fallbacks et par UI Preview pour tout lister. */
export const ALL_RAF_STATES: readonly RafState[] = [
  "neutral",
  "happy",
  "clever",
  "thinking",
  "analyzing",
  "searching",
  "scanning",
  "comparing",
  "notifying",
  "emptySearch",
  "emptyNoResults",
  "emptyError",
  "warning",
  "badDeal",
  "goodDeal",
  "gem",
  "megaDeal",
];

/**
 * Statut d'identification -> état Raf. C'est le mapping réellement utilisé
 * aujourd'hui par l'écran de résultat du scan carte (seule donnée réelle
 * disponible pour la catégorie TCG).
 */
export function getRafStateForIdentificationStatus(status: RafAnalysisStatus): RafState {
  switch (status) {
    case "identified":
      return "happy";
    case "needs_confirmation":
      return "thinking";
    case "insufficient_data":
      return "warning";
    case "failed":
      return "warning";
  }
}

/** Un des 4 réglages de progression réels (`AnalysisProgressPhase` + "idle") — jamais une étape fabriquée qui n'existe pas côté backend (voir AnalysisLoadingScreen). */
export function getRafStateForProgress(phase: "uploading" | "submitting" | "polling"): RafState {
  switch (phase) {
    case "uploading":
      return "scanning";
    case "submitting":
      return "analyzing";
    case "polling":
      return "searching";
  }
}

/** Reflète `analysisDecisionSchema` (`@dealradar/contracts`) — 4 valeurs réelles, jamais renommées ici. */
export type BusinessDecision = "BUY" | "REVIEW" | "PASS" | "INSUFFICIENT_DATA";

export type DealTier = "bad" | "risk" | "average" | "good" | "excellent" | "exceptional";

const DEAL_TIER_TO_RAF_STATE: Record<DealTier, RafState> = {
  bad: "badDeal",
  risk: "warning",
  average: "thinking",
  good: "goodDeal",
  excellent: "gem",
  exceptional: "megaDeal",
};

export function getRafStateForDealTier(tier: DealTier): RafState {
  return DEAL_TIER_TO_RAF_STATE[tier];
}

/**
 * Dérive un `DealTier` d'affichage à partir d'une décision déjà prise
 * côté serveur (`decision`) et, seulement pour affiner l'intérieur d'un
 * "BUY", du `dealScore` déjà calculé (0-100, `computeDealScore`) — ne
 * RECALCULE jamais la décision elle-même : `PASS` reste toujours "bad",
 * `REVIEW` toujours "average"/"risk" selon la confiance, quel que soit le
 * score. Les seuils ci-dessous ne créent aucune décision BUY/REVIEW/PASS
 * concurrente ; ils choisissent seulement, à l'intérieur d'un "BUY" déjà
 * décidé, quel visuel (bonne affaire / pépite / méga-affaire) le
 * représente le mieux — une affaire "exceptionnelle" reste une affaire
 * "BUY", jamais une 5e décision métier.
 */
export function getDealTierFromDecision(decision: BusinessDecision, dealScore: number | null): DealTier {
  if (decision === "PASS") return "bad";
  if (decision === "INSUFFICIENT_DATA") return "risk";
  if (decision === "REVIEW") return "average";
  // decision === "BUY" : affiner avec le score déjà calculé si disponible.
  if (dealScore === null) return "good";
  if (dealScore >= 95) return "exceptional";
  if (dealScore >= 85) return "excellent";
  return "good";
}

/** Libellé FR du verdict pour affichage (Phase 8) — dérivé de `decision`, jamais un texte inventé sans lien avec la valeur réelle. */
export function getVerdictLabel(decision: BusinessDecision): string {
  switch (decision) {
    case "BUY":
      return "ACHETER";
    case "REVIEW":
      return "ATTENDRE";
    case "PASS":
      return "PASSER";
    case "INSUFFICIENT_DATA":
      return "DONNÉES INSUFFISANTES";
  }
}
