import { describe, expect, it } from "vitest";
import {
  emptySourceHealthState,
  recordSourceRun,
  averageLatencyMs,
  isSourceHealthy,
  disableSource,
  enableSource,
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
