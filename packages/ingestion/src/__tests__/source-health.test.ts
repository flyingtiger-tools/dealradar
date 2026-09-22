import { describe, expect, it } from "vitest";
import { emptySourceHealthState } from "@dealradar/connectors";
import { FakeSupabase } from "./fake-supabase";
import { loadSourceHealthStates, persistSourceHealthState, updateSourceHealthFromDiagnostics, toHealthLevels } from "../source-health";
import type { SourceDiagnostic } from "../aggregate-market-observations";

const ASOF = "2026-09-21T00:00:00.000Z";

describe("loadSourceHealthStates", () => {
  it("source absente de la table : état vide (healthy), jamais une erreur", async () => {
    const db = new FakeSupabase();
    const states = await loadSourceHealthStates(db as never, ["bricklink"]);
    expect(states.bricklink).toEqual(emptySourceHealthState("bricklink"));
  });

  it("source présente : état chargé depuis la ligne", async () => {
    const db = new FakeSupabase();
    db.seed("source_health_state", [
      { source: "bricklink", enabled: true, last_success_at: ASOF, last_failure_at: null, last_failure_reason_class: null, recent_latencies_ms: [100], requests_used: 1, total_estimated_cost_usd: 0, consecutive_failures: 0, aborted_count: 0, timeout_count: 0, observations_returned_total: 3 },
    ]);
    const states = await loadSourceHealthStates(db as never, ["bricklink"]);
    expect(states.bricklink?.lastSuccessAt).toBe(ASOF);
    expect(states.bricklink?.observationsReturnedTotal).toBe(3);
  });

  it("liste vide : aucun appel réseau, objet vide", async () => {
    const db = new FakeSupabase();
    const states = await loadSourceHealthStates(db as never, []);
    expect(states).toEqual({});
  });
});

describe("persistSourceHealthState", () => {
  it("upsert idempotent par source", async () => {
    const db = new FakeSupabase();
    const state = { ...emptySourceHealthState("bricklink"), requestsUsed: 5 };
    await persistSourceHealthState(db as never, state);
    await persistSourceHealthState(db as never, { ...state, requestsUsed: 6 });
    const rows = db.table("source_health_state") as { source: string; requests_used: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requests_used).toBe(6);
  });
});

describe("updateSourceHealthFromDiagnostics — fonction PURE", () => {
  it("status 'aborted' : JAMAIS compté comme un échec, consecutiveFailures inchangé", () => {
    const states = { bricklink: emptySourceHealthState("bricklink") };
    const diagnostics: SourceDiagnostic[] = [{ source: "bricklink", status: "aborted", observationCount: 0, latencyMs: 10 }];
    const next = updateSourceHealthFromDiagnostics(states, diagnostics, ASOF);
    expect(next.bricklink?.consecutiveFailures).toBe(0);
    expect(next.bricklink?.abortedCount).toBe(1);
    expect(next.bricklink?.lastFailureAt).toBeNull();
  });

  it("status 'timeout' : compté comme un échec RÉEL, classe 'timeout'", () => {
    const states = { bricklink: emptySourceHealthState("bricklink") };
    const diagnostics: SourceDiagnostic[] = [{ source: "bricklink", status: "timeout", observationCount: 0, latencyMs: 8000 }];
    const next = updateSourceHealthFromDiagnostics(states, diagnostics, ASOF);
    expect(next.bricklink?.consecutiveFailures).toBe(1);
    expect(next.bricklink?.timeoutCount).toBe(1);
    expect(next.bricklink?.lastFailureReasonClass).toBe("timeout");
  });

  it("status 'success' : observationCount accumulé, consecutiveFailures décrémenté (jamais sous 0)", () => {
    const states = { bricklink: emptySourceHealthState("bricklink") };
    const diagnostics: SourceDiagnostic[] = [{ source: "bricklink", status: "success", observationCount: 4, latencyMs: 100 }];
    const next = updateSourceHealthFromDiagnostics(states, diagnostics, ASOF);
    expect(next.bricklink?.observationsReturnedTotal).toBe(4);
    expect(next.bricklink?.consecutiveFailures).toBe(0);
  });

  it("source absente de l'état initial : part d'un état vide, jamais une exception", () => {
    const diagnostics: SourceDiagnostic[] = [{ source: "new_source", status: "success", observationCount: 1, latencyMs: 50 }];
    const next = updateSourceHealthFromDiagnostics({}, diagnostics, ASOF);
    expect(next.new_source?.requestsUsed).toBe(1);
  });
});

describe("toHealthLevels", () => {
  it("projette classifySourceHealth pour chaque source", () => {
    const states = { bricklink: emptySourceHealthState("bricklink") };
    expect(toHealthLevels(states)).toEqual({ bricklink: "healthy" });
  });
});
