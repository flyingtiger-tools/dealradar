import type { CostClass } from "./snapshot-scheduling-policy";

/**
 * Politique de nouvel essai DÉTERMINISTE (LOT "Close the Refresh Loop",
 * section 4) — fonction PURE, ne planifie ni ne déploie rien elle-même.
 * Distingue explicitement les CAUSES d'échec d'un cycle de rafraîchissement
 * — un conflit d'identité n'est jamais traité comme une panne réseau, une
 * indisponibilité FX n'est jamais traitée comme une source payante à
 * ménager (règle explicite du lot : "identity conflict should be
 * distinguishable from network failure").
 */
export type RefreshFailureReason =
  | "transient_source_outage"
  | "all_sources_unavailable"
  | "identity_too_weak"
  | "persistence_only_failure"
  | "fx_unavailable"
  | "policy_disabled_source_set"
  | "hard_data_conflict"
  /**
   * Le cycle s'est arrêté parce que la DÉADLINE DU RUN de rafraîchissement
   * (`runDueMarketRefreshBatch`, `apps/workers`) a expiré PENDANT ce cycle
   * — jamais une panne fournisseur (LOT "Interactive History + Generic
   * Result UI + Full Cancellation + Pre-Prod Activation Package", section
   * 8 : "an operator/deadline abort is NOT a provider outage"). Distinct
   * de `transient_source_outage` précisément pour que `decideRefreshRetry`
   * puisse appliquer un délai COURT ET NEUTRE, sans pénalité de priorité —
   * voir le `case` dédié ci-dessous.
   */
  | "run_deadline_exceeded";

export interface RefreshOutcomeInput {
  /** `true` si AU MOINS une observation exploitable a été obtenue — un instantané partiel compte comme un succès s'il apporte une preuve utile (règle explicite du lot), même si certaines sources ont échoué. */
  hasUsefulEvidence: boolean;
  /** `undefined`/absent si `hasUsefulEvidence` est `true` (pas d'échec à classer). */
  failureReason?: RefreshFailureReason;
  consecutiveFailures: number;
  /** Classe de coût de la source LA PLUS CHÈRE impliquée dans ce cycle — un plancher de délai est appliqué, jamais dépassé, même après un succès (voir `snapshot-scheduling-policy.ts`, même discipline). */
  costClass: CostClass;
}

export interface RefreshRetryDecision {
  /** `true` = succès (même partiel avec preuve utile) — `consecutiveFailures` doit être remis à 0 par l'appelant. */
  isSuccess: boolean;
  delayHours: number;
  /** 0–100 — baisse avec des échecs complets répétés (instruction explicite du lot), jamais figée. */
  priorityAdjustment: number;
  reason: string;
}

const COST_CLASS_MIN_DELAY_HOURS: Record<CostClass, number> = { free: 1, cheap: 4, paid: 12, high_cost: 48 };
const MAX_BACKOFF_HOURS = 72;

/** Délai borné de type exponentiel — JAMAIS illimité (plafond `MAX_BACKOFF_HOURS`), jamais plus rapide que le plancher de classe de coût ("do not hammer paid/high-cost sources", instruction explicite du lot). */
function boundedBackoffHours(baseHours: number, consecutiveFailures: number, costClass: CostClass): number {
  const exponential = baseHours * 2 ** Math.min(consecutiveFailures, 6); // plafonné à 2^6 = x64 pour éviter un dépassement numérique absurde avant le plafond dur
  const floor = COST_CLASS_MIN_DELAY_HOURS[costClass];
  return Math.min(MAX_BACKOFF_HOURS, Math.max(floor, exponential));
}

/**
 * Décide le délai/l'ajustement de priorité pour LE PROCHAIN cycle à partir
 * du résultat RÉEL de CE cycle — jamais une supposition sur ce qui aurait
 * dû se passer. Un succès (même partiel avec preuve utile) programme un
 * délai NORMAL (repris de la politique de planification existante côté
 * appelant, voir `decideNextSnapshotRefresh`) ; un échec programme un
 * délai de repli déterministe selon la cause précise.
 */
export function decideRefreshRetry(input: RefreshOutcomeInput): RefreshRetryDecision {
  if (input.hasUsefulEvidence) {
    return {
      isSuccess: true,
      delayHours: COST_CLASS_MIN_DELAY_HOURS[input.costClass],
      priorityAdjustment: 0,
      reason: "Cycle réussi (preuve utile obtenue) — délai normal, aucune pénalité de priorité.",
    };
  }

  const reason = input.failureReason ?? "all_sources_unavailable";

  switch (reason) {
    case "identity_too_weak":
      // Pas une panne réseau — retenter plus vite n'aiderait en rien tant que l'identité n'est pas enrichie ; délai long mais SANS pénalité de priorité punitive (le produit lui-même n'est pas en cause).
      return { isSuccess: false, delayHours: Math.max(COST_CLASS_MIN_DELAY_HOURS[input.costClass], 24), priorityAdjustment: 0, reason: "Identité trop faible pour un plan de requête exploitable — jamais une panne réseau, délai long sans pénalité de priorité." };

    case "policy_disabled_source_set":
      // Aucune source utilisable par POLITIQUE (restricted/disabled_policy/license_required) — retenter ne changera rien tant que la politique ne change pas ; délai très long, jamais de pénalité (ce n'est pas un échec du produit).
      return { isSuccess: false, delayHours: MAX_BACKOFF_HOURS, priorityAdjustment: 0, reason: "Aucune source utilisable par politique (restricted/disabled_policy/license_required) — délai maximal, jamais de pénalité de priorité." };

    case "hard_data_conflict":
      // Un conflit d'identité dur bloque les requêtes exactes — distinct d'une panne réseau (instruction explicite du lot), délai modéré, pas de pénalité punitive (nécessite une résolution, pas un simple nouvel essai).
      return { isSuccess: false, delayHours: Math.max(COST_CLASS_MIN_DELAY_HOURS[input.costClass], 12), priorityAdjustment: 0, reason: "Conflit d'identité dur non résolu — distinct d'une panne réseau, délai modéré, résolution requise plutôt qu'un simple nouvel essai." };

    case "persistence_only_failure":
      // La collecte a réussi, seule l'écriture a échoué — jamais traité comme une panne de source, un délai court suffit (probablement transitoire côté base).
      return { isSuccess: false, delayHours: COST_CLASS_MIN_DELAY_HOURS[input.costClass], priorityAdjustment: 0, reason: "Échec de PERSISTANCE uniquement (la collecte a réussi) — jamais traité comme une panne de source, nouvel essai rapide." };

    case "fx_unavailable":
      return { isSuccess: false, delayHours: Math.max(COST_CLASS_MIN_DELAY_HOURS[input.costClass], 6), priorityAdjustment: 0, reason: "Taux de change indisponible — délai court à modéré, jamais une pénalité de priorité (limite externe, pas un échec du produit)." };

    case "run_deadline_exceeded":
      // Annulation OPÉRATEUR (déadline du run), jamais une panne fournisseur — délai COURT et neutre (même plancher qu'un succès), AUCUNE pénalité de priorité, jamais de backoff exponentiel (section 8 : "do not penalize... do not lower product priority solely because the batch deadline hit").
      return { isSuccess: false, delayHours: COST_CLASS_MIN_DELAY_HOURS[input.costClass], priorityAdjustment: 0, reason: "Déadline du run de rafraîchissement atteinte pendant ce cycle — annulation opérateur, jamais une panne fournisseur ; nouvel essai court, sans pénalité de priorité." };

    case "transient_source_outage":
    case "all_sources_unavailable":
    default: {
      // Échec complet, potentiellement réseau — backoff exponentiel borné, ET une pénalité de priorité qui grandit avec des échecs répétés (instruction explicite : "repeated complete failures should lower priority / increase delay").
      const delayHours = boundedBackoffHours(COST_CLASS_MIN_DELAY_HOURS[input.costClass], input.consecutiveFailures, input.costClass);
      const priorityAdjustment = -Math.min(40, input.consecutiveFailures * 10);
      return {
        isSuccess: false,
        delayHours,
        priorityAdjustment,
        reason: `Échec complet (${reason}) — délai exponentiel borné (${delayHours}h), priorité réduite de ${Math.abs(priorityAdjustment)} après ${input.consecutiveFailures} échec(s) consécutif(s).`,
      };
    }
  }
}
