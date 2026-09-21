import { describe, expect, it } from "vitest";
import { decideRefreshRetry } from "../refresh-retry-policy";

describe("decideRefreshRetry", () => {
  it("succès (preuve utile) : délai normal, jamais de pénalité de priorité", () => {
    const decision = decideRefreshRetry({ hasUsefulEvidence: true, consecutiveFailures: 3, costClass: "free" });
    expect(decision.isSuccess).toBe(true);
    expect(decision.priorityAdjustment).toBe(0);
  });

  it("panne réseau transitoire : backoff EXPONENTIEL borné, priorité réduite avec des échecs répétés", () => {
    const first = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: 0, costClass: "free" });
    const third = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: 2, costClass: "free" });
    expect(third.delayHours).toBeGreaterThan(first.delayHours);
    expect(third.priorityAdjustment).toBeLessThan(first.priorityAdjustment);
  });

  it("backoff JAMAIS illimité — plafonné même après de nombreux échecs", () => {
    const manyFailures = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "all_sources_unavailable", consecutiveFailures: 100, costClass: "free" });
    expect(manyFailures.delayHours).toBeLessThanOrEqual(72);
  });

  it("jamais plus rapide que le plancher de classe de coût, même pour un premier échec", () => {
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: 0, costClass: "high_cost" });
    expect(decision.delayHours).toBeGreaterThanOrEqual(48);
  });

  it("conflit d'identité DUR : distinct d'une panne réseau, jamais de pénalité de priorité punitive", () => {
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "hard_data_conflict", consecutiveFailures: 5, costClass: "free" });
    expect(decision.priorityAdjustment).toBe(0);
    expect(decision.reason).toContain("Conflit");
  });

  it("identité trop faible : jamais une panne réseau, jamais de pénalité", () => {
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "identity_too_weak", consecutiveFailures: 5, costClass: "free" });
    expect(decision.priorityAdjustment).toBe(0);
  });

  it("ensemble de sources bloqué par POLITIQUE : délai maximal, jamais de pénalité (pas un échec du produit)", () => {
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "policy_disabled_source_set", consecutiveFailures: 1, costClass: "free" });
    expect(decision.delayHours).toBe(72);
    expect(decision.priorityAdjustment).toBe(0);
  });

  it("échec de PERSISTANCE uniquement : nouvel essai rapide, jamais traité comme une panne de source", () => {
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "persistence_only_failure", consecutiveFailures: 3, costClass: "free" });
    expect(decision.delayHours).toBe(1);
    expect(decision.priorityAdjustment).toBe(0);
  });

  it("FX indisponible : délai court à modéré, jamais de pénalité de priorité", () => {
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "fx_unavailable", consecutiveFailures: 2, costClass: "free" });
    expect(decision.priorityAdjustment).toBe(0);
  });

  it("ne jamais marteler une source payante/coûteuse : le plancher grandit avec la classe de coût", () => {
    const free = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: 0, costClass: "free" });
    const paid = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: 0, costClass: "paid" });
    const highCost = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: 0, costClass: "high_cost" });
    expect(paid.delayHours).toBeGreaterThan(free.delayHours);
    expect(highCost.delayHours).toBeGreaterThan(paid.delayHours);
  });
});
