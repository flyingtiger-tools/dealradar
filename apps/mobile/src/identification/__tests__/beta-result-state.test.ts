import { betaResultReducer, initialBetaResultState } from "../beta-result-state";
import type { RafAnalysis } from "../types";

function fakeAnalysis(): RafAnalysis {
  return {
    category: "pokemon_tcg",
    status: "identified",
    product: { name: "Nymble", setName: "Phantasmal Flames", collectorNumber: "096", language: "en" },
    confidence: 0.9,
    decision: null,
    valuation: { low: 1, high: 2, currency: "CHF" },
    evidence: [],
    missingInformation: [],
    risks: [],
    analysisId: "analysis-1",
  };
}

describe("betaResultReducer", () => {
  it("état initial : idle", () => {
    expect(initialBetaResultState).toEqual({ phase: "idle" });
  });

  it("ANALYSIS_STARTED depuis idle : passe à analyzing", () => {
    const state = betaResultReducer(initialBetaResultState, { type: "ANALYSIS_STARTED" });
    expect(state).toEqual({ phase: "analyzing" });
  });

  it("double clic : un second ANALYSIS_STARTED pendant analyzing est ignoré (pas de double appel)", () => {
    const analyzing = betaResultReducer(initialBetaResultState, { type: "ANALYSIS_STARTED" });
    const stillAnalyzing = betaResultReducer(analyzing, { type: "ANALYSIS_STARTED" });
    expect(stillAnalyzing).toBe(analyzing);
  });

  it("ANALYSIS_SUCCEEDED depuis analyzing : passe à result avec l'analyse", () => {
    const analyzing = betaResultReducer(initialBetaResultState, { type: "ANALYSIS_STARTED" });
    const result = betaResultReducer(analyzing, { type: "ANALYSIS_SUCCEEDED", analysis: fakeAnalysis() });
    expect(result).toEqual({ phase: "result", analysis: fakeAnalysis() });
  });

  it("ANALYSIS_SUCCEEDED hors phase analyzing : ignoré", () => {
    const state = betaResultReducer(initialBetaResultState, { type: "ANALYSIS_SUCCEEDED", analysis: fakeAnalysis() });
    expect(state).toEqual({ phase: "idle" });
  });

  it("ANALYSIS_FAILED depuis analyzing : passe à error avec le message", () => {
    const analyzing = betaResultReducer(initialBetaResultState, { type: "ANALYSIS_STARTED" });
    const errored = betaResultReducer(analyzing, { type: "ANALYSIS_FAILED", message: "Erreur réseau" });
    expect(errored).toEqual({ phase: "error", message: "Erreur réseau" });
  });

  it("RESET depuis n'importe quelle phase : retour à idle", () => {
    const result: ReturnType<typeof betaResultReducer> = { phase: "result", analysis: fakeAnalysis() };
    expect(betaResultReducer(result, { type: "RESET" })).toEqual({ phase: "idle" });

    const errored: ReturnType<typeof betaResultReducer> = { phase: "error", message: "x" };
    expect(betaResultReducer(errored, { type: "RESET" })).toEqual({ phase: "idle" });
  });
});
