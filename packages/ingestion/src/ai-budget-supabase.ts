import type { SupabaseClient } from "@supabase/supabase-js";
import type { BudgetGuard, BudgetOutcome } from "@dealradar/ai";

export interface AiBudgetConfig {
  provider: string;
  model: string;
  dailyBudgetUsd: number;
  listingId?: string | null;
}

/**
 * Implémentation Supabase de `BudgetGuard` (@dealradar/ai) — appelle les
 * fonctions Postgres transactionnelles `reserve_ai_budget`/
 * `finalize_ai_budget`/`release_ai_budget` (migration 0011). Toute la
 * garantie d'atomicité vit dans ces fonctions (verrou `pg_advisory_xact_lock`
 * par (provider, jour)) — ce module ne fait qu'appeler le RPC, aucun calcul
 * de budget côté application.
 */
export function createSupabaseBudgetGuard(supabase: SupabaseClient, config: AiBudgetConfig): BudgetGuard {
  return {
    async reserve(maxCostUsd: number) {
      const { data, error } = await supabase.rpc("reserve_ai_budget", {
        p_provider: config.provider,
        p_model: config.model,
        p_max_cost_usd: maxCostUsd,
        p_daily_budget_usd: config.dailyBudgetUsd,
        p_listing_id: config.listingId ?? null,
      });
      if (error) {
        throw new Error(`Réservation du budget IA impossible : ${error.message}`);
      }
      const reservationId = data as string | null;
      return reservationId ? { reservationId } : null;
    },
    async finalize(reservationId: string, outcome: BudgetOutcome) {
      const { error } = await supabase.rpc("finalize_ai_budget", {
        p_reservation_id: reservationId,
        p_status: outcome.status,
        p_input_units: outcome.inputUnits,
        p_output_units: outcome.outputUnits,
        p_estimated_cost_usd: outcome.estimatedCostUsd,
      });
      if (error) {
        throw new Error(`Finalisation du budget IA impossible : ${error.message}`);
      }
    },
    async release(reservationId: string) {
      const { error } = await supabase.rpc("release_ai_budget", { p_reservation_id: reservationId });
      if (error) {
        throw new Error(`Libération du budget IA impossible : ${error.message}`);
      }
    },
  };
}
