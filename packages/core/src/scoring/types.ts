import type { ComparableSet, Listing, Score, Verdict } from "../types/domain";

/**
 * Contrat des moteurs de score (ADR 0006).
 * Fonctions pures, déterministes, versionnées : mêmes entrées → même score.
 */
export interface ScoringInput {
  listing: Pick<Listing, "id" | "priceCents" | "condition" | "firstSeenAt">;
  comparables: ComparableSet;
}

export interface ScoringEngine {
  readonly scoreType: Score["scoreType"];
  readonly version: string;
  compute(input: ScoringInput): ScoringResult;
}

export interface ScoringResult {
  value: number;
  verdict: Verdict | null;
  explanation: Record<string, unknown>;
}
