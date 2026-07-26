import { describe, expect, it } from "vitest";
import { createSupabaseBudgetGuard } from "../ai-budget-supabase";
import { FakeSupabase } from "./fake-supabase";

/**
 * Simule le comportement de `reserve_ai_budget`/`finalize_ai_budget`/
 * `release_ai_budget` (migration 0011) pour tester la mécanique côté
 * application sans Postgres réel (Docker/local Postgres indisponible dans
 * cet environnement — limite déjà documentée depuis le Lot 4). La garantie
 * transactionnelle elle-même (verrou `pg_advisory_xact_lock`) est vérifiée
 * par lecture de la migration SQL et, si des identifiants cloud sont
 * disponibles, par un test d'intégration optionnel séparé.
 */
function registerFakeBudgetRpcs(supabase: FakeSupabase, dailyBudgetUsd: number): void {
  let spent = 0;
  let nextId = 1;
  supabase.registerRpc("reserve_ai_budget", (params) => {
    const maxCost = params.p_max_cost_usd as number;
    if (spent + maxCost > dailyBudgetUsd) return { data: null, error: null };
    spent += maxCost;
    return { data: `res-${nextId++}`, error: null };
  });
  supabase.registerRpc("finalize_ai_budget", () => ({ data: null, error: null }));
  supabase.registerRpc("release_ai_budget", () => ({ data: null, error: null }));
}

describe("createSupabaseBudgetGuard", () => {
  it("reserve() retourne un reservationId quand le budget est suffisant", async () => {
    const supabase = new FakeSupabase();
    registerFakeBudgetRpcs(supabase, 1);
    const guard = createSupabaseBudgetGuard(supabase as never, { provider: "openai", model: "gpt-4o-mini", dailyBudgetUsd: 1 });

    const reservation = await guard.reserve(0.001);
    expect(reservation?.reservationId).toBeTruthy();
  });

  it("reserve() retourne null quand le budget journalier est dépassé", async () => {
    const supabase = new FakeSupabase();
    registerFakeBudgetRpcs(supabase, 0.0005);
    const guard = createSupabaseBudgetGuard(supabase as never, { provider: "openai", model: "gpt-4o-mini", dailyBudgetUsd: 0.0005 });

    const reservation = await guard.reserve(0.001);
    expect(reservation).toBeNull();
  });

  it("finalize() et release() n'échouent pas pour une réservation existante", async () => {
    const supabase = new FakeSupabase();
    registerFakeBudgetRpcs(supabase, 1);
    const guard = createSupabaseBudgetGuard(supabase as never, { provider: "openai", model: "gpt-4o-mini", dailyBudgetUsd: 1 });

    const reservation = await guard.reserve(0.001);
    await expect(
      guard.finalize(reservation!.reservationId, { status: "completed", inputUnits: 100, outputUnits: 50, estimatedCostUsd: 0.0005 }),
    ).resolves.toBeUndefined();
    await expect(guard.release(reservation!.reservationId)).resolves.toBeUndefined();
  });

  it("propage une erreur explicite si le RPC échoue", async () => {
    const supabase = new FakeSupabase();
    supabase.registerRpc("reserve_ai_budget", () => ({ data: null, error: { message: "fonction absente" } }));
    const guard = createSupabaseBudgetGuard(supabase as never, { provider: "openai", model: "gpt-4o-mini", dailyBudgetUsd: 1 });

    await expect(guard.reserve(0.001)).rejects.toThrow(/fonction absente/);
  });
});
