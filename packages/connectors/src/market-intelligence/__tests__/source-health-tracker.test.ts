import { describe, expect, it } from "vitest";
import {
  emptySourceHealthState,
  recordSourceRun,
  averageLatencyMs,
  isSourceHealthy,
  disableSource,
  enableSource,
  classifySourceHealth,
  type SourceHealthState,
} from "../source-health-tracker";

describe("emptySourceHealthState", () => {
  it("état initial : activée, saine (aucun échec connu), aucune statistique", () => {
    const state = emptySourceHealthState("ebay");
    expect(state.enabled).toBe(true);
    expect(isSourceHealthy(state)).toBe(true);
    expect(state.requestsUsed).toBe(0);
    expect(averageLatencyMs(state)).toBeNull();
  });
});

describe("recordSourceRun", () => {
  it("jamais une mutation de l'état existant — retourne toujours un nouvel objet", () => {
    const before = emptySourceHealthState("ebay");
    const after = recordSourceRun(before, { source: "ebay", success: true, latencyMs: 100, estimatedCostUsd: null, occurredAt: "2026-09-21T00:00:00.000Z" });
    expect(after).not.toBe(before);
    expect(before.requestsUsed).toBe(0);
    expect(after.requestsUsed).toBe(1);
  });

  it("succès : lastSuccessAt mis à jour, lastFailureAt inchangé, source reste saine", () => {
    let state = emptySourceHealthState("ebay");
    state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: 120, estimatedCostUsd: 0.01, occurredAt: "2026-09-21T00:00:00.000Z" });
    expect(state.lastSuccessAt).toBe("2026-09-21T00:00:00.000Z");
    expect(state.lastFailureAt).toBeNull();
    expect(isSourceHealthy(state)).toBe(true);
    expect(state.totalEstimatedCostUsd).toBeCloseTo(0.01);
  });

  it("échec après un succès plus ancien : devient malsaine (dernier échec plus récent que le dernier succès)", () => {
    let state = emptySourceHealthState("ebay");
    state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: 100, estimatedCostUsd: null, occurredAt: "2026-09-21T00:00:00.000Z" });
    state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 8000, failureReasonClass: "timeout", estimatedCostUsd: null, occurredAt: "2026-09-21T00:05:00.000Z" });
    expect(isSourceHealthy(state)).toBe(false);
    expect(state.lastFailureReasonClass).toBe("timeout");
  });

  it("un succès après un échec rend la source de nouveau saine", () => {
    let state = emptySourceHealthState("ebay");
    state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 500, failureReasonClass: "network", estimatedCostUsd: null, occurredAt: "2026-09-21T00:00:00.000Z" });
    expect(isSourceHealthy(state)).toBe(false);
    state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: 100, estimatedCostUsd: null, occurredAt: "2026-09-21T00:05:00.000Z" });
    expect(isSourceHealthy(state)).toBe(true);
  });

  it("conserve au plus les 20 dernières latences (fenêtre glissante), jamais une croissance illimitée", () => {
    let state = emptySourceHealthState("ebay");
    for (let i = 0; i < 25; i++) {
      state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: i, estimatedCostUsd: null, occurredAt: "2026-09-21T00:00:00.000Z" });
    }
    expect(state.recentLatenciesMs).toHaveLength(20);
    expect(state.recentLatenciesMs[0]).toBe(5); // les 5 premières (0-4) ont été évincées
  });
});

describe("averageLatencyMs", () => {
  it("calcule la moyenne des échantillons récents", () => {
    let state = emptySourceHealthState("ebay");
    state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: 100, estimatedCostUsd: null, occurredAt: "t" });
    state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: 200, estimatedCostUsd: null, occurredAt: "t" });
    expect(averageLatencyMs(state)).toBe(150);
  });
});

describe("abandon opérateur/utilisateur (LOT 'Product History UX + Source Health + Interactive Cancellation + Beta Readiness', section 4) — NEUTRE, jamais un échec", () => {
  it("aborted:true n'affecte JAMAIS lastFailureAt/lastFailureReasonClass/consecutiveFailures, même après plusieurs abandons", () => {
    let state = emptySourceHealthState("ebay");
    for (let i = 0; i < 5; i++) {
      state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 10, estimatedCostUsd: null, occurredAt: "t", aborted: true });
    }
    expect(state.lastFailureAt).toBeNull();
    expect(state.lastFailureReasonClass).toBeNull();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.abortedCount).toBe(5);
    expect(classifySourceHealth(state)).toBe("healthy");
  });

  it("un abandon n'efface jamais un échec RÉEL déjà enregistré — reste malsaine", () => {
    let state = emptySourceHealthState("ebay");
    state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 500, failureReasonClass: "network", estimatedCostUsd: null, occurredAt: "2026-09-21T00:00:00.000Z" });
    state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 10, estimatedCostUsd: null, occurredAt: "2026-09-21T00:05:00.000Z", aborted: true });
    expect(isSourceHealthy(state)).toBe(false);
    expect(state.consecutiveFailures).toBe(1); // inchangé par l'abandon qui suit.
    expect(state.abortedCount).toBe(1);
  });

  it("timedOut:true (panne fournisseur réelle) EST compté comme un échec, distinct d'un abandon", () => {
    let state = emptySourceHealthState("ebay");
    state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 8000, failureReasonClass: "timeout", estimatedCostUsd: null, occurredAt: "t", timedOut: true });
    expect(state.consecutiveFailures).toBe(1);
    expect(state.timeoutCount).toBe(1);
    expect(state.abortedCount).toBe(0);
  });
});

describe("classifySourceHealth — récupération GRADUELLE (section 4)", () => {
  it("aucun échec : healthy", () => {
    expect(classifySourceHealth(emptySourceHealthState("ebay"))).toBe("healthy");
  });

  it("1-2 échecs consécutifs : degraded", () => {
    let state = emptySourceHealthState("ebay");
    state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 10, estimatedCostUsd: null, occurredAt: "t" });
    expect(classifySourceHealth(state)).toBe("degraded");
  });

  it("3+ échecs consécutifs : unhealthy", () => {
    let state = emptySourceHealthState("ebay");
    for (let i = 0; i < 3; i++) state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 10, estimatedCostUsd: null, occurredAt: "t" });
    expect(classifySourceHealth(state)).toBe("unhealthy");
  });

  it("un seul succès après plusieurs échecs ne restaure JAMAIS instantanément 'healthy' — récupération graduelle", () => {
    let state = emptySourceHealthState("ebay");
    for (let i = 0; i < 4; i++) state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 10, estimatedCostUsd: null, occurredAt: "t" });
    expect(classifySourceHealth(state)).toBe("unhealthy");
    state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: 10, estimatedCostUsd: null, occurredAt: "t" });
    expect(state.consecutiveFailures).toBe(3); // décrémenté de 1 seulement, jamais remis à 0.
    expect(classifySourceHealth(state)).toBe("unhealthy"); // toujours pas guérie après un seul succès.
  });

  it("plusieurs succès consécutifs finissent par restaurer 'healthy'", () => {
    let state = emptySourceHealthState("ebay");
    for (let i = 0; i < 3; i++) state = recordSourceRun(state, { source: "ebay", success: false, latencyMs: 10, estimatedCostUsd: null, occurredAt: "t" });
    for (let i = 0; i < 3; i++) state = recordSourceRun(state, { source: "ebay", success: true, latencyMs: 10, estimatedCostUsd: null, occurredAt: "t" });
    expect(classifySourceHealth(state)).toBe("healthy");
  });

  it("une source désactivée reste 'unhealthy' même sans aucun échec", () => {
    const state = disableSource(emptySourceHealthState("ebay"));
    expect(classifySourceHealth(state)).toBe("unhealthy");
  });
});

describe("disableSource / enableSource", () => {
  it("une source désactivée n'est jamais saine, même sans échec connu", () => {
    const state: SourceHealthState = disableSource(emptySourceHealthState("ebay"));
    expect(isSourceHealthy(state)).toBe(false);
  });

  it("réactiver restaure la santé si aucun échec plus récent qu'un succès n'existe", () => {
    const state = enableSource(disableSource(emptySourceHealthState("ebay")));
    expect(isSourceHealthy(state)).toBe(true);
  });
});
