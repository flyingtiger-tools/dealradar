/**
 * Primitives de routage IA futur (Phase 8, ADR 0013 — étape "cheapest model
 * passing quality threshold") — types + une fonction pure de sélection,
 * PREPARED uniquement. Rien ici n'est appelé par `apps/workers` : aucune
 * décision de routage automatique n'est prise en production par ce module.
 * Alimenté plus tard par `packages/benchmark/src/tcg` (mesures réelles),
 * jamais par une estimation devinée à la main.
 */

export type AiRoutingProvider = "openai" | "anthropic" | "groq" | "openrouter";

/** Un modèle précis, jamais un provider entier — deux modèles du même provider sont deux candidats distincts. */
export interface ModelCandidate {
  provider: AiRoutingProvider;
  model: string;
}

/**
 * Qualité MESURÉE d'un candidat sur une tâche donnée — jamais une note
 * devinée. `measuredAt` est obligatoire pour que l'appelant puisse juger
 * la fraîcheur de la mesure (un profil vieux de plusieurs mois n'a pas la
 * même confiance qu'un profil de la veille).
 */
export interface ModelQualityProfile {
  candidate: ModelCandidate;
  /** Précision d'identification exacte mesurée (voir `TcgMatrixMetrics.exactIdentificationAccuracy`, packages/benchmark) — null si jamais mesuré. */
  measuredExactAccuracy: number | null;
  measuredAvgLatencyMs: number | null;
  /** Coût moyen par identification réussie — null si le modèle n'a pas d'entrée fiable dans COST_TABLE. */
  measuredCostPerSuccessUsd: number | null;
  /** ISO 8601 — jamais un profil traité comme permanent. */
  measuredAt: string | null;
}

/**
 * Une seule valeur produite aujourd'hui par `selectCheapestPassingCandidate()`
 * ci-dessous — délibérément pas un enum plus large ("low_confidence",
 * "ambiguous_candidates", etc.) : ces cas décriraient une vraie escalade
 * multi-étapes (retenter avec un autre candidat après un premier échec),
 * qui n'existe pas encore comme logique réelle. Étendre cet enum seulement
 * quand une fonction produit effectivement ces valeurs — jamais avant.
 */
export type EscalationReason = "no_candidate_meets_threshold";

export interface RoutingDecision {
  /** null = aucun candidat ne passe le seuil de qualité — jamais un choix par défaut fabriqué ; l'appelant doit alors refuser d'appeler l'IA. */
  chosen: ModelCandidate | null;
  reason: string;
  escalationReason: EscalationReason | null;
}

export interface RoutingPolicy {
  /** Seuil minimal de `measuredExactAccuracy` pour qu'un candidat soit éligible. */
  qualityThreshold: number;
  /** Non trié par cette fonction — l'appelant fournit déjà l'ordre de préférence (ex. coût croissant). */
  candidates: ModelQualityProfile[];
}

/**
 * Sélectionne le premier candidat de la liste (déjà ordonnée par
 * l'appelant, ex. coût croissant) dont la qualité mesurée passe le seuil.
 * Un candidat jamais mesuré (`measuredExactAccuracy: null`) n'est jamais
 * éligible — mesurer avant de router, jamais deviner.
 */
export function selectCheapestPassingCandidate(policy: RoutingPolicy): RoutingDecision {
  const eligible = policy.candidates.find(
    (profile) => profile.measuredExactAccuracy !== null && profile.measuredExactAccuracy >= policy.qualityThreshold,
  );

  if (!eligible) {
    return {
      chosen: null,
      reason: `Aucun candidat mesuré n'atteint le seuil de qualité (${policy.qualityThreshold}).`,
      escalationReason: "no_candidate_meets_threshold",
    };
  }

  return {
    chosen: eligible.candidate,
    reason: `Premier candidat éligible (précision mesurée ${eligible.measuredExactAccuracy} >= seuil ${policy.qualityThreshold}).`,
    escalationReason: null,
  };
}
