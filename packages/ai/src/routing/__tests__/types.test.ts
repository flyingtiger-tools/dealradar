import { describe, expect, it } from "vitest";
import { selectCheapestPassingCandidate } from "../types";
import type { ModelQualityProfile } from "../types";

function profile(overrides: Partial<ModelQualityProfile> = {}): ModelQualityProfile {
  return {
    candidate: { provider: "groq", model: "llama-3.3-70b-versatile" },
    measuredExactAccuracy: 0.9,
    measuredAvgLatencyMs: 500,
    measuredCostPerSuccessUsd: 0.001,
    measuredAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectCheapestPassingCandidate — jamais un choix fabriqué", () => {
  it("choisit le premier candidat éligible dans l'ordre fourni", () => {
    const decision = selectCheapestPassingCandidate({
      qualityThreshold: 0.8,
      candidates: [profile(), profile({ candidate: { provider: "openai", model: "gpt-4o-mini" }, measuredExactAccuracy: 0.95 })],
    });
    expect(decision.chosen).toEqual({ provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(decision.escalationReason).toBeNull();
  });

  it("candidat jamais mesuré (null) : jamais éligible même si tous les autres échouent", () => {
    const decision = selectCheapestPassingCandidate({
      qualityThreshold: 0.8,
      candidates: [profile({ measuredExactAccuracy: null })],
    });
    expect(decision.chosen).toBeNull();
    expect(decision.escalationReason).toBe("no_candidate_meets_threshold");
  });

  it("aucun candidat n'atteint le seuil : chosen null, jamais un candidat sous le seuil choisi par défaut", () => {
    const decision = selectCheapestPassingCandidate({
      qualityThreshold: 0.99,
      candidates: [profile({ measuredExactAccuracy: 0.9 })],
    });
    expect(decision.chosen).toBeNull();
  });

  it("liste vide : jamais une exception, chosen null", () => {
    const decision = selectCheapestPassingCandidate({ qualityThreshold: 0.8, candidates: [] });
    expect(decision.chosen).toBeNull();
  });

  it("seuil atteint exactement (>=) : éligible", () => {
    const decision = selectCheapestPassingCandidate({
      qualityThreshold: 0.9,
      candidates: [profile({ measuredExactAccuracy: 0.9 })],
    });
    expect(decision.chosen).not.toBeNull();
  });
});
