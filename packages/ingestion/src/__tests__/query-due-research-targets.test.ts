import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { queryDueResearchTargets } from "../query-due-research-targets";

const NOW = new Date("2026-09-21T12:00:00.000Z");

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    product_key: "apple:iphone-13",
    reason: "user_scan",
    priority: 50,
    desired_currency: "EUR",
    enabled: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    last_refreshed_at: null,
    next_refresh_at: null,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    attempt_count: 0,
    last_error: null,
    last_success_at: null,
    consecutive_failures: 0,
    ...overrides,
  };
}

describe("queryDueResearchTargets", () => {
  it("inclut une cible jamais rafraîchie (next_refresh_at null)", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("research_targets", [baseRow({ id: 1, next_refresh_at: null })]);
    const result = await queryDueResearchTargets(supabase as never, { limit: 10, now: NOW });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(1);
  });

  it("inclut une cible dont l'échéance est passée, exclut une échéance future", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("research_targets", [
      baseRow({ id: 1, next_refresh_at: "2026-09-21T00:00:00.000Z" }), // passée
      baseRow({ id: 2, next_refresh_at: "2026-09-22T00:00:00.000Z" }), // future
    ]);
    const result = await queryDueResearchTargets(supabase as never, { limit: 10, now: NOW });
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it("exclut une cible désactivée même si due", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("research_targets", [baseRow({ id: 1, enabled: false, next_refresh_at: null })]);
    const result = await queryDueResearchTargets(supabase as never, { limit: 10, now: NOW });
    expect(result).toEqual([]);
  });

  it("ordonne par priorité décroissante, puis échéance la plus ancienne (jamais rafraîchie en premier)", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("research_targets", [
      baseRow({ id: 1, priority: 10, next_refresh_at: null }),
      baseRow({ id: 2, priority: 90, next_refresh_at: "2026-09-20T00:00:00.000Z" }),
      baseRow({ id: 3, priority: 90, next_refresh_at: "2026-09-10T00:00:00.000Z" }),
    ]);
    const result = await queryDueResearchTargets(supabase as never, { limit: 10, now: NOW });
    expect(result.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it("respecte la taille de lot bornée", async () => {
    const supabase = new FakeSupabase();
    supabase.seed(
      "research_targets",
      Array.from({ length: 5 }, (_, i) => baseRow({ id: i + 1, next_refresh_at: null })),
    );
    const result = await queryDueResearchTargets(supabase as never, { limit: 2, now: NOW });
    expect(result).toHaveLength(2);
  });

  it("renvoie un modèle typé camelCase, pas les colonnes snake_case brutes", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("research_targets", [baseRow({ id: 1, next_refresh_at: null, consecutive_failures: 3 })]);
    const result = await queryDueResearchTargets(supabase as never, { limit: 10, now: NOW });
    expect(result[0]?.consecutiveFailures).toBe(3);
    expect(result[0]).not.toHaveProperty("consecutive_failures");
  });
});
