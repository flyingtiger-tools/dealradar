import { describe, it, expect } from "vitest";
import { RETENTION_POLICIES, selectRowsEligibleForCleanup, selectCancelledAnalysisRequestsEligibleForCleanup } from "../retention-policy";

const ASOF = new Date("2026-09-21T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(ASOF.getTime() - days * DAY_MS).toISOString();
}

describe("RETENTION_POLICIES", () => {
  it("une politique par table, aucun doublon", () => {
    const tables = RETENTION_POLICIES.map((p) => p.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("market_observations n'a AUCUNE politique — rétention illimitée, jamais un nettoyage automatique", () => {
    expect(RETENTION_POLICIES.some((p) => (p.table as string) === "market_observations")).toBe(false);
  });
});

describe("selectRowsEligibleForCleanup — fonction pure générique", () => {
  const policy = RETENTION_POLICIES.find((p) => p.table === "market_refresh_runs")!;

  it("ligne plus ancienne que retentionDays : éligible", () => {
    const rows = [{ id: 1, created_at: daysAgo(200) }];
    expect(selectRowsEligibleForCleanup(rows, policy, ASOF)).toEqual(rows);
  });

  it("ligne plus récente que retentionDays : jamais éligible", () => {
    const rows = [{ id: 1, created_at: daysAgo(5) }];
    expect(selectRowsEligibleForCleanup(rows, policy, ASOF)).toEqual([]);
  });

  it("ligne exactement à la limite (retentionDays pile) : pas encore éligible (limite stricte <, jamais <=)", () => {
    const rows = [{ id: 1, created_at: daysAgo(policy.retentionDays) }];
    expect(selectRowsEligibleForCleanup(rows, policy, ASOF)).toEqual([]);
  });

  it("colonne timestamp absente/invalide : jamais éligible (repli sûr, jamais une suppression sur une donnée ambiguë)", () => {
    const rows = [{ id: 1 }, { id: 2, created_at: null }, { id: 3, created_at: "pas-une-date" }];
    expect(selectRowsEligibleForCleanup(rows, policy, ASOF)).toEqual([]);
  });

  it("mélange de lignes éligibles/non-éligibles : ne retourne que les éligibles, jamais toutes ni aucune", () => {
    const old = { id: 1, created_at: daysAgo(200) };
    const recent = { id: 2, created_at: daysAgo(5) };
    expect(selectRowsEligibleForCleanup([old, recent], policy, ASOF)).toEqual([old]);
  });

  it("aucune ligne fournie : tableau vide, jamais une exception", () => {
    expect(selectRowsEligibleForCleanup([], policy, ASOF)).toEqual([]);
  });
});

describe("selectCancelledAnalysisRequestsEligibleForCleanup — spécialisation par statut", () => {
  it("status='cancelled' + assez ancienne : éligible", () => {
    const rows = [{ id: "a", status: "cancelled", updated_at: daysAgo(60) }];
    expect(selectCancelledAnalysisRequestsEligibleForCleanup(rows, ASOF)).toEqual(rows);
  });

  it("status='completed' même très ancienne : JAMAIS éligible — aucune politique de rétention pour les analyses terminées avec succès dans ce lot", () => {
    const rows = [{ id: "a", status: "completed", updated_at: daysAgo(1000) }];
    expect(selectCancelledAnalysisRequestsEligibleForCleanup(rows, ASOF)).toEqual([]);
  });

  it("status='failed'/'insufficient_data' même très anciennes : jamais éligibles non plus", () => {
    const rows = [
      { id: "a", status: "failed", updated_at: daysAgo(1000) },
      { id: "b", status: "insufficient_data", updated_at: daysAgo(1000) },
    ];
    expect(selectCancelledAnalysisRequestsEligibleForCleanup(rows, ASOF)).toEqual([]);
  });

  it("status='cancelled' mais récente (< 30 jours) : pas encore éligible", () => {
    const rows = [{ id: "a", status: "cancelled", updated_at: daysAgo(5) }];
    expect(selectCancelledAnalysisRequestsEligibleForCleanup(rows, ASOF)).toEqual([]);
  });

  it("mélange réaliste : ne retourne QUE les cancelled anciennes, jamais les autres statuts ni les cancelled récentes", () => {
    const eligibleCancelled = { id: "a", status: "cancelled", updated_at: daysAgo(60) };
    const recentCancelled = { id: "b", status: "cancelled", updated_at: daysAgo(2) };
    const oldCompleted = { id: "c", status: "completed", updated_at: daysAgo(500) };
    const result = selectCancelledAnalysisRequestsEligibleForCleanup([eligibleCancelled, recentCancelled, oldCompleted], ASOF);
    expect(result).toEqual([eligibleCancelled]);
  });
});
