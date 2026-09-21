import type { CostClass } from "./snapshot-scheduling-policy";

/**
 * Garde-fous de budget d'exécution PAR CYCLE DE RAFRAÎCHISSEMENT (LOT
 * "Close the Refresh Loop", section 5) — fonction PURE, jamais un système
 * de facturation (aucun montant réel suivi, uniquement des CLASSES de
 * coût et des COMPTES). Décide, pour une source candidate, si le budget
 * du run permet encore de l'interroger — jamais après coup : appelée
 * AVANT chaque appel réseau, jamais un contrôle a posteriori qui aurait
 * déjà dépensé le budget.
 */
export interface RefreshBudgetLimits {
  maxTargetsPerRun: number;
  maxSourcesPerTarget: number;
  /** Plafond PAR CIBLE des sources "paid" ET "high_cost" confondues. */
  maxPaidSourcesPerTarget: number;
  /** Plafond PAR CIBLE des sources "high_cost" UNIQUEMENT — sous-ensemble plus strict de `maxPaidSourcesPerTarget` (LOT "Real DB Integration...", section 3). */
  maxHighCostSourcesPerTarget: number;
  maxHighCostSourcesPerRun: number;
  /** Plafond sur TOUT le run des sources "paid" ET "high_cost" confondues — jamais réinitialisé par cible. `undefined` = aucune restriction (limite optionnelle, "if useful" — instruction explicite du lot). */
  maxPaidSourcesPerRun?: number;
  /** Classe de coût maximale autorisée sur l'ensemble du run — au-delà, une source plus chère que ce plafond est refusée même si son propre plafond individuel n'est pas atteint. `undefined` = aucune restriction globale. */
  maxRunCostClass?: CostClass;
  totalRunTimeoutMs: number;
}

export const DEFAULT_REFRESH_BUDGET_LIMITS: RefreshBudgetLimits = {
  maxTargetsPerRun: 20,
  maxSourcesPerTarget: 6,
  maxPaidSourcesPerTarget: 3,
  maxHighCostSourcesPerTarget: 1,
  maxHighCostSourcesPerRun: 2,
  totalRunTimeoutMs: 5 * 60 * 1000,
};

export interface RefreshBudgetState {
  targetsProcessed: number;
  sourcesQueriedForCurrentTarget: number;
  paidSourcesQueriedForCurrentTarget: number;
  /** PAR CIBLE, "high_cost" uniquement — réinitialisé à chaque nouvelle cible, jamais confondu avec `highCostSourcesQueriedThisRun` (run-wide). */
  highCostSourcesQueriedForCurrentTarget: number;
  highCostSourcesQueriedThisRun: number;
  /** RUN-WIDE, "paid" ET "high_cost" confondues — jamais réinitialisé par cible (même discipline que `highCostSourcesQueriedThisRun`). */
  paidSourcesQueriedThisRun: number;
  runStartedAtMs: number;
}

export function initialRefreshBudgetState(runStartedAtMs: number): RefreshBudgetState {
  return {
    targetsProcessed: 0,
    sourcesQueriedForCurrentTarget: 0,
    paidSourcesQueriedForCurrentTarget: 0,
    highCostSourcesQueriedForCurrentTarget: 0,
    highCostSourcesQueriedThisRun: 0,
    paidSourcesQueriedThisRun: 0,
    runStartedAtMs,
  };
}

const COST_CLASS_ORDER: Record<CostClass, number> = { free: 0, cheap: 1, paid: 2, high_cost: 3 };

export interface BudgetCheckResult {
  allowed: boolean;
  /** `undefined` si `allowed === true`. */
  reason?: string;
}

/** Le run entier peut-il encore traiter une cible SUPPLÉMENTAIRE (compte ET délai) ? */
export function canProcessAnotherTarget(state: RefreshBudgetState, limits: RefreshBudgetLimits, nowMs: number): BudgetCheckResult {
  if (state.targetsProcessed >= limits.maxTargetsPerRun) {
    return { allowed: false, reason: `Plafond de cibles par run atteint (${limits.maxTargetsPerRun}) — cibles restantes différées, jamais marquées rafraîchies.` };
  }
  if (nowMs - state.runStartedAtMs >= limits.totalRunTimeoutMs) {
    return { allowed: false, reason: `Délai total du run dépassé (${limits.totalRunTimeoutMs}ms) — cibles restantes différées, jamais marquées rafraîchies.` };
  }
  return { allowed: true };
}

/** Une source précise (avec sa classe de coût) peut-elle encore être interrogée pour la cible EN COURS ? */
export function canQuerySource(state: RefreshBudgetState, limits: RefreshBudgetLimits, costClass: CostClass): BudgetCheckResult {
  if (state.sourcesQueriedForCurrentTarget >= limits.maxSourcesPerTarget) {
    return { allowed: false, reason: `Plafond de sources par cible atteint (${limits.maxSourcesPerTarget}).` };
  }
  if (limits.maxRunCostClass && COST_CLASS_ORDER[costClass] > COST_CLASS_ORDER[limits.maxRunCostClass]) {
    return { allowed: false, reason: `Classe de coût "${costClass}" au-delà du plafond de run ("${limits.maxRunCostClass}").` };
  }
  if ((costClass === "paid" || costClass === "high_cost") && state.paidSourcesQueriedForCurrentTarget >= limits.maxPaidSourcesPerTarget) {
    return { allowed: false, reason: `Plafond de sources payantes par cible atteint (${limits.maxPaidSourcesPerTarget}).` };
  }
  if (costClass === "high_cost" && state.highCostSourcesQueriedForCurrentTarget >= limits.maxHighCostSourcesPerTarget) {
    return { allowed: false, reason: `Plafond de sources à coût élevé PAR CIBLE atteint (${limits.maxHighCostSourcesPerTarget}).` };
  }
  if (costClass === "high_cost" && state.highCostSourcesQueriedThisRun >= limits.maxHighCostSourcesPerRun) {
    return { allowed: false, reason: `Plafond de sources à coût élevé pour tout le run atteint (${limits.maxHighCostSourcesPerRun}).` };
  }
  if (limits.maxPaidSourcesPerRun !== undefined && (costClass === "paid" || costClass === "high_cost") && state.paidSourcesQueriedThisRun >= limits.maxPaidSourcesPerRun) {
    return { allowed: false, reason: `Plafond de sources payantes pour tout le run atteint (${limits.maxPaidSourcesPerRun}).` };
  }
  return { allowed: true };
}

/** Met à jour l'état APRÈS avoir effectivement interrogé une source — jamais avant (le budget ne doit refléter que ce qui a RÉELLEMENT été dépensé). */
export function recordSourceQueried(state: RefreshBudgetState, costClass: CostClass): RefreshBudgetState {
  const isPaidOrHighCost = costClass === "paid" || costClass === "high_cost";
  return {
    ...state,
    sourcesQueriedForCurrentTarget: state.sourcesQueriedForCurrentTarget + 1,
    paidSourcesQueriedForCurrentTarget: state.paidSourcesQueriedForCurrentTarget + (isPaidOrHighCost ? 1 : 0),
    highCostSourcesQueriedForCurrentTarget: state.highCostSourcesQueriedForCurrentTarget + (costClass === "high_cost" ? 1 : 0),
    highCostSourcesQueriedThisRun: state.highCostSourcesQueriedThisRun + (costClass === "high_cost" ? 1 : 0),
    paidSourcesQueriedThisRun: state.paidSourcesQueriedThisRun + (isPaidOrHighCost ? 1 : 0),
  };
}

/** Réinitialise les compteurs PAR CIBLE en commençant une nouvelle cible — les compteurs À L'ÉCHELLE DU RUN (targetsProcessed, highCostSourcesQueriedThisRun, paidSourcesQueriedThisRun) ne sont JAMAIS réinitialisés ici. */
export function recordTargetStarted(state: RefreshBudgetState): RefreshBudgetState {
  return {
    ...state,
    targetsProcessed: state.targetsProcessed + 1,
    sourcesQueriedForCurrentTarget: 0,
    paidSourcesQueriedForCurrentTarget: 0,
    highCostSourcesQueriedForCurrentTarget: 0,
  };
}
