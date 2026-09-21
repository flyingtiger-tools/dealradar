import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFRESH_BUDGET_LIMITS,
  initialRefreshBudgetState,
  canProcessAnotherTarget,
  canQuerySource,
  recordSourceQueried,
  recordTargetStarted,
} from "../refresh-budget";

describe("canProcessAnotherTarget", () => {
  it("autorise tant que le plafond de cibles et le délai total ne sont pas atteints", () => {
    const state = initialRefreshBudgetState(0);
    const result = canProcessAnotherTarget(state, DEFAULT_REFRESH_BUDGET_LIMITS, 1000);
    expect(result.allowed).toBe(true);
  });

  it("refuse au-delà du plafond de cibles par run", () => {
    let state = initialRefreshBudgetState(0);
    for (let i = 0; i < DEFAULT_REFRESH_BUDGET_LIMITS.maxTargetsPerRun; i++) state = recordTargetStarted(state);
    const result = canProcessAnotherTarget(state, DEFAULT_REFRESH_BUDGET_LIMITS, 1000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cibles");
  });

  it("refuse au-delà du délai total du run", () => {
    const state = initialRefreshBudgetState(0);
    const result = canProcessAnotherTarget(state, DEFAULT_REFRESH_BUDGET_LIMITS, DEFAULT_REFRESH_BUDGET_LIMITS.totalRunTimeoutMs + 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Délai");
  });
});

describe("canQuerySource", () => {
  it("autorise une source gratuite tant que le plafond par cible n'est pas atteint", () => {
    const state = initialRefreshBudgetState(0);
    expect(canQuerySource(state, DEFAULT_REFRESH_BUDGET_LIMITS, "free").allowed).toBe(true);
  });

  it("refuse au-delà du plafond de sources PAR CIBLE", () => {
    let state = initialRefreshBudgetState(0);
    for (let i = 0; i < DEFAULT_REFRESH_BUDGET_LIMITS.maxSourcesPerTarget; i++) state = recordSourceQueried(state, "free");
    expect(canQuerySource(state, DEFAULT_REFRESH_BUDGET_LIMITS, "free").allowed).toBe(false);
  });

  it("refuse au-delà du plafond de sources PAYANTES par cible, même si le plafond global de sources n'est pas atteint", () => {
    let state = initialRefreshBudgetState(0);
    for (let i = 0; i < DEFAULT_REFRESH_BUDGET_LIMITS.maxPaidSourcesPerTarget; i++) state = recordSourceQueried(state, "paid");
    const result = canQuerySource(state, DEFAULT_REFRESH_BUDGET_LIMITS, "paid");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("payantes");
  });

  it("refuse au-delà du plafond de sources à coût élevé POUR TOUT LE RUN, jamais réinitialisé entre cibles", () => {
    let state = initialRefreshBudgetState(0);
    for (let i = 0; i < DEFAULT_REFRESH_BUDGET_LIMITS.maxHighCostSourcesPerRun; i++) state = recordSourceQueried(state, "high_cost");
    state = recordTargetStarted(state); // nouvelle cible — le compteur PAR CIBLE est réinitialisé, mais pas highCostSourcesQueriedThisRun
    const result = canQuerySource(state, DEFAULT_REFRESH_BUDGET_LIMITS, "high_cost");
    expect(result.allowed).toBe(false);
  });

  it("maxRunCostClass exclut une classe de coût au-delà du plafond, même sous les autres plafonds", () => {
    const state = initialRefreshBudgetState(0);
    const result = canQuerySource(state, { ...DEFAULT_REFRESH_BUDGET_LIMITS, maxRunCostClass: "cheap" }, "paid");
    expect(result.allowed).toBe(false);
  });

  it("recordTargetStarted ne réinitialise JAMAIS les compteurs à l'échelle du run (targetsProcessed, highCostSourcesQueriedThisRun)", () => {
    let state = initialRefreshBudgetState(0);
    state = recordTargetStarted(state);
    state = recordSourceQueried(state, "high_cost");
    state = recordTargetStarted(state);
    expect(state.targetsProcessed).toBe(2);
    expect(state.highCostSourcesQueriedThisRun).toBe(1);
    expect(state.sourcesQueriedForCurrentTarget).toBe(0); // réinitialisé PAR CIBLE, correctement
  });

  it("refuse au-delà du plafond de sources à coût élevé PAR CIBLE, même sous le plafond payant par cible et le plafond run-wide", () => {
    let state = initialRefreshBudgetState(0);
    for (let i = 0; i < DEFAULT_REFRESH_BUDGET_LIMITS.maxHighCostSourcesPerTarget; i++) state = recordSourceQueried(state, "high_cost");
    const result = canQuerySource(state, DEFAULT_REFRESH_BUDGET_LIMITS, "high_cost");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("PAR CIBLE");
  });

  it("recordTargetStarted réinitialise highCostSourcesQueriedForCurrentTarget (par cible), jamais highCostSourcesQueriedThisRun (run-wide)", () => {
    let state = initialRefreshBudgetState(0);
    state = recordSourceQueried(state, "high_cost");
    state = recordTargetStarted(state);
    expect(state.highCostSourcesQueriedForCurrentTarget).toBe(0);
    expect(state.highCostSourcesQueriedThisRun).toBe(1);
  });

  it("maxPaidSourcesPerRun (optionnel) refuse au-delà du plafond RUN-WIDE payant, jamais réinitialisé entre cibles", () => {
    const limits = { ...DEFAULT_REFRESH_BUDGET_LIMITS, maxPaidSourcesPerTarget: 10, maxHighCostSourcesPerTarget: 10, maxHighCostSourcesPerRun: 10, maxPaidSourcesPerRun: 2 };
    let state = initialRefreshBudgetState(0);
    state = recordSourceQueried(state, "paid");
    state = recordTargetStarted(state);
    state = recordSourceQueried(state, "paid");
    state = recordTargetStarted(state); // troisième cible — paidSourcesQueriedThisRun = 2, jamais réinitialisé.
    const result = canQuerySource(state, limits, "paid");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("run");
  });

  it("maxPaidSourcesPerRun absent (undefined) : aucune restriction run-wide payante appliquée", () => {
    let state = initialRefreshBudgetState(0);
    for (let i = 0; i < 50; i++) state = recordSourceQueried(state, "paid");
    expect(canQuerySource(state, { ...DEFAULT_REFRESH_BUDGET_LIMITS, maxSourcesPerTarget: 100, maxPaidSourcesPerTarget: 100 }, "paid").allowed).toBe(true);
  });
});
