import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { getOperatorObservabilitySummary } from "../operator-observability";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function runRow(overrides: Record<string, unknown>) {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    run_key: overrides.run_key,
    lease_owner: "worker-a",
    started_at: NOW.toISOString(),
    finished_at: NOW.toISOString(),
    considered: 1,
    claimed: 1,
    succeeded: 1,
    failed: 0,
    observations_persisted: 1,
    target_counts_by_outcome: {},
    source_counts_by_status: {},
    error_class_counts: {},
    elapsed_ms: 1000,
    timed_out: false,
    budget_exhausted: false,
    ...overrides,
  };
}

function targetRow(overrides: Record<string, unknown>) {
  return {
    run_id: overrides.run_id,
    research_target_id: 1,
    product_key: "lego:10300",
    claimed_at: NOW.toISOString(),
    started_at: NOW.toISOString(),
    finished_at: NOW.toISOString(),
    outcome: "succeeded",
    failure_reason: null,
    selected_sources: ["bricklink"],
    skipped_source_reasons: {},
    observations_returned: 1,
    observations_persisted: 1,
    fx_skipped_count: 0,
    identity_conflict_count: 0,
    next_refresh_at: null,
    safe_error_class: null,
    ...overrides,
  };
}

describe("getOperatorObservabilitySummary", () => {
  it("aucune donnée : résumé vide, jamais une exception", async () => {
    const db = new FakeSupabase();
    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW });
    expect(summary.runCount).toBe(0);
    expect(summary.successRate).toBeNull();
    expect(summary.failedTargetsByReason).toEqual([]);
  });

  it("taux de succès calculé sur les runs AVEC activité (claimed > 0) uniquement", async () => {
    const db = new FakeSupabase();
    db.seed("market_refresh_runs", [
      runRow({ id: 1, run_key: "run-1", claimed: 2, failed: 0 }),
      runRow({ id: 2, run_key: "run-2", claimed: 2, failed: 1 }),
      runRow({ id: 3, run_key: "run-3", claimed: 0, failed: 0 }), // aucune activité, exclu du taux.
    ]);

    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW });
    expect(summary.successRate).toBe(0.5); // 1 sur 2 runs AVEC activité sans échec.
  });

  it("échecs par raison agrégés à travers les runs récents", async () => {
    const db = new FakeSupabase();
    db.seed("market_refresh_runs", [runRow({ id: 1, run_key: "run-1" })]);
    db.seed("market_refresh_run_targets", [
      targetRow({ run_id: 1, outcome: "failed", failure_reason: "fx_unavailable" }),
      targetRow({ run_id: 1, outcome: "failed", failure_reason: "fx_unavailable" }),
      targetRow({ run_id: 1, outcome: "failed", failure_reason: "identity_too_weak" }),
    ]);

    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW });
    expect(summary.failedTargetsByReason).toEqual([
      { reason: "fx_unavailable", count: 2 },
      { reason: "identity_too_weak", count: 1 },
    ]);
  });

  it("compteurs d'erreur par source dérivés de skipped_source_reasons — jamais une URL/valeur de credential", async () => {
    const db = new FakeSupabase();
    db.seed("market_refresh_runs", [runRow({ id: 1, run_key: "run-1" })]);
    db.seed("market_refresh_run_targets", [
      targetRow({ run_id: 1, skipped_source_reasons: { ricardo: "Verrouillé par politique.", keepa: "Credentials manquantes." } }),
      targetRow({ run_id: 1, skipped_source_reasons: { keepa: "Credentials manquantes." } }),
    ]);

    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW });
    expect(summary.sourceErrorCounts).toEqual([
      { source: "keepa", count: 2 },
      { source: "ricardo", count: 1 },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/api[_-]?key/i);
  });

  it("cibles dues et EN RETARD distinguées — retard uniquement au-delà du seuil configuré", async () => {
    const db = new FakeSupabase();
    db.seed("research_targets", [
      { next_refresh_at: null, enabled: true }, // jamais rafraîchi -> due.
      { next_refresh_at: new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString(), enabled: true }, // due depuis 1h -> due, PAS en retard (seuil 24h).
      { next_refresh_at: new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(), enabled: true }, // due depuis 48h -> due ET en retard.
      { next_refresh_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(), enabled: true }, // future -> ni due ni en retard.
      { next_refresh_at: new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(), enabled: false }, // désactivée -> jamais comptée.
    ]);

    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW, overdueThresholdHours: 24 });
    expect(summary.dueTargetCount).toBe(3);
    expect(summary.overdueTargetCount).toBe(1);
  });

  it("budgetExhaustedRunCount / timedOutRunCount distincts", async () => {
    const db = new FakeSupabase();
    db.seed("market_refresh_runs", [
      runRow({ id: 1, run_key: "run-1", budget_exhausted: true, timed_out: false }),
      runRow({ id: 2, run_key: "run-2", budget_exhausted: false, timed_out: true }),
      runRow({ id: 3, run_key: "run-3", budget_exhausted: false, timed_out: false }),
    ]);

    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW });
    expect(summary.budgetExhaustedRunCount).toBe(1);
    expect(summary.timedOutRunCount).toBe(1);
  });

  it("produits avec conflits d'identité non résolus, triés par compte décroissant, plafonné à 10", async () => {
    const db = new FakeSupabase();
    db.seed("market_refresh_runs", [runRow({ id: 1, run_key: "run-1" })]);
    db.seed("market_refresh_run_targets", [
      targetRow({ run_id: 1, product_key: "apple:iphone-13", identity_conflict_count: 2 }),
      targetRow({ run_id: 1, product_key: "lego:10300", identity_conflict_count: 5 }),
      targetRow({ run_id: 1, product_key: "no-conflict:item", identity_conflict_count: 0 }),
    ]);

    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW });
    expect(summary.topUnresolvedIdentityConflictProducts).toEqual([
      { productKey: "lego:10300", conflictCount: 5 },
      { productKey: "apple:iphone-13", conflictCount: 2 },
    ]);
  });

  it("sourceReadiness est un simple passe-plat de ce que l'appelant fournit, jamais recalculé", async () => {
    const db = new FakeSupabase();
    const summary = await getOperatorObservabilitySummary(db as never, {
      now: () => NOW,
      sourceReadiness: [{ source: "ebay", readiness: "ready" }],
    });
    expect(summary.sourceReadiness).toEqual([{ source: "ebay", readiness: "ready" }]);
  });

  it("observationsPersistedByDay agrège par jour (YYYY-MM-DD)", async () => {
    const db = new FakeSupabase();
    db.seed("market_refresh_runs", [runRow({ id: 1, run_key: "run-1" })]);
    db.seed("market_refresh_run_targets", [
      targetRow({ run_id: 1, finished_at: "2026-09-20T10:00:00.000Z", observations_persisted: 3 }),
      targetRow({ run_id: 1, finished_at: "2026-09-20T14:00:00.000Z", observations_persisted: 2 }),
      targetRow({ run_id: 1, finished_at: "2026-09-21T08:00:00.000Z", observations_persisted: 4 }),
    ]);

    const summary = await getOperatorObservabilitySummary(db as never, { now: () => NOW });
    expect(summary.observationsPersistedByDay).toEqual({ "2026-09-20": 5, "2026-09-21": 4 });
  });
});
