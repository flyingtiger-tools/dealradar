import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { persistRefreshRunAudit } from "../persist-refresh-run-audit";

function baseInput(overrides: Partial<Parameters<typeof persistRefreshRunAudit>[0]> = {}) {
  const db = overrides.supabase ?? (new FakeSupabase() as never);
  return {
    supabase: db,
    runKey: "run-1",
    leaseOwner: "worker-a",
    startedAt: "2026-09-21T12:00:00.000Z",
    finishedAt: "2026-09-21T12:00:05.000Z",
    considered: 3,
    claimed: 2,
    succeeded: 1,
    failed: 1,
    observationsPersisted: 4,
    targetCountsByOutcome: { succeeded: 1, identity_too_weak: 1 },
    sourceCountsByStatus: { success: 2, error: 1 },
    errorClassCounts: {},
    elapsedMs: 5000,
    timedOut: false,
    budgetExhausted: false,
    targets: [],
    ...overrides,
  };
}

describe("persistRefreshRunAudit", () => {
  it("persiste une ligne market_refresh_runs avec les compteurs fournis", async () => {
    const db = new FakeSupabase();
    const result = await persistRefreshRunAudit(baseInput({ supabase: db as never }));

    expect(result.targetRowsInserted).toBe(0);
    const row = db.table("market_refresh_runs")[0] as Record<string, unknown>;
    expect(row.run_key).toBe("run-1");
    expect(row.considered).toBe(3);
    expect(row.claimed).toBe(2);
    expect(row.succeeded).toBe(1);
    expect(row.failed).toBe(1);
    expect(row.timed_out).toBe(false);
  });

  it("persiste une ligne market_refresh_run_targets PAR cible, liée au run par run_id", async () => {
    const db = new FakeSupabase();
    const result = await persistRefreshRunAudit(
      baseInput({
        supabase: db as never,
        targets: [
          {
            researchTargetId: 1,
            productKey: "lego:10300",
            claimedAt: "2026-09-21T12:00:00.000Z",
            startedAt: "2026-09-21T12:00:00.100Z",
            finishedAt: "2026-09-21T12:00:01.000Z",
            outcome: "succeeded",
            failureReason: null,
            selectedSources: ["bricklink"],
            skippedSourceReasons: { ricardo: "Verrouillé par politique." },
            observationsReturned: 3,
            observationsPersisted: 3,
            fxSkippedCount: 0,
            identityConflictCount: 0,
            nextRefreshAt: "2026-09-22T00:00:00.000Z",
            safeErrorClass: null,
          },
        ],
      }),
    );

    expect(result.targetRowsInserted).toBe(1);
    const targetRow = db.table("market_refresh_run_targets")[0] as Record<string, unknown>;
    expect(targetRow.run_id).toBe(result.runId);
    expect(targetRow.product_key).toBe("lego:10300");
    expect(targetRow.outcome).toBe("succeeded");
    expect(targetRow.selected_sources).toEqual(["bricklink"]);
  });

  it("idempotent sur run_key : rejouer le même run (même clé) met à jour la ligne existante, jamais un doublon", async () => {
    const db = new FakeSupabase();
    await persistRefreshRunAudit(baseInput({ supabase: db as never }));
    await persistRefreshRunAudit(baseInput({ supabase: db as never, succeeded: 2 }));

    expect(db.table("market_refresh_runs")).toHaveLength(1);
    const row = db.table("market_refresh_runs")[0] as Record<string, unknown>;
    expect(row.succeeded).toBe(2);
  });

  it("jamais une valeur de credential dans les lignes persistées", async () => {
    const db = new FakeSupabase();
    await persistRefreshRunAudit(
      baseInput({
        supabase: db as never,
        targets: [
          {
            researchTargetId: 1,
            productKey: "lego:10300",
            claimedAt: null,
            startedAt: null,
            finishedAt: null,
            outcome: "failed",
            failureReason: "all_sources_unavailable",
            selectedSources: [],
            skippedSourceReasons: { keepa: "Credentials manquantes." },
            observationsReturned: 0,
            observationsPersisted: 0,
            fxSkippedCount: 0,
            identityConflictCount: 0,
            nextRefreshAt: null,
            safeErrorClass: "all_sources_unavailable",
          },
        ],
      }),
    );

    const serialized = JSON.stringify([...db.table("market_refresh_runs"), ...db.table("market_refresh_run_targets")]);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toContain("secret");
  });
});
