/**
 * Abstraction pure du budget IA — `packages/ai` ne parle jamais directement
 * à Postgres. C'est l'appelant (`packages/ingestion`) qui fournit une
 * implémentation adossée aux fonctions RPC `reserve_ai_budget`/
 * `finalize_ai_budget`/`release_ai_budget` (garantie d'atomicité réelle,
 * verrou transactionnel par (provider, jour) — voir migration 0011).
 */
export interface BudgetReservation {
  reservationId: string;
}

export interface BudgetOutcome {
  status: "completed" | "failed";
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsd: number;
}

export interface BudgetGuard {
  /** Réserve un coût maximal estimé avant l'appel provider. `null` = budget insuffisant, aucun appel réseau ne doit avoir lieu. */
  reserve(maxCostUsd: number): Promise<BudgetReservation | null>;
  /** Ajuste la réservation avec le coût réel une fois la réponse (ou l'échec définitif) connue. */
  finalize(reservationId: string, outcome: BudgetOutcome): Promise<void>;
  /** Libère une réservation jamais consommée (ex. abandon avant tout appel réseau réel). */
  release(reservationId: string): Promise<void>;
}
