import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Cible de recherche (LOT "Historical Data Engine", section 9) — voir
 * `research_targets` (migration 0020, jamais appliquée à la Production
 * par ce lot). PAS un objet d'interface : une donnée de planification pure
 * qui permet à un scan utilisateur d'amorcer un suivi de prix à long terme.
 */
export const researchTargetReasonSchema = z.enum(["user_scan", "watchlist", "high_activity", "manual_seed"]);
export type ResearchTargetReason = z.infer<typeof researchTargetReasonSchema>;

export const researchTargetInputSchema = z.object({
  productKey: z.string().min(1),
  reason: researchTargetReasonSchema,
  priority: z.number().min(0).max(100),
  desiredCurrency: z.string().length(3),
  enabled: z.boolean(),
  nextRefreshAt: z.string().min(1).nullish(),
});
export type ResearchTargetInput = z.infer<typeof researchTargetInputSchema>;

export type PersistResearchTargetOutcome = "inserted" | "updated";
export interface PersistResearchTargetResult {
  outcome: PersistResearchTargetOutcome;
}

/**
 * Upsert idempotent sur `(product_key, desired_currency)` — un second scan
 * du même produit dans la même devise met à jour la cible existante
 * (priorité/raison/prochaine échéance), jamais un doublon silencieux.
 */
export async function persistResearchTarget(supabase: SupabaseClient, input: ResearchTargetInput): Promise<PersistResearchTargetResult> {
  const parsed = researchTargetInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Cible de recherche invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`);
  }
  const v = parsed.data;

  const { data: existing } = await supabase
    .from("research_targets")
    .select("id")
    .eq("product_key", v.productKey)
    .eq("desired_currency", v.desiredCurrency)
    .maybeSingle();

  const { error } = await supabase.from("research_targets").upsert(
    {
      product_key: v.productKey,
      reason: v.reason,
      priority: v.priority,
      desired_currency: v.desiredCurrency,
      enabled: v.enabled,
      next_refresh_at: v.nextRefreshAt ?? null,
    },
    { onConflict: "product_key,desired_currency" },
  );
  if (error) {
    throw new Error(`Persistance de la cible de recherche impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }

  return { outcome: existing ? "updated" : "inserted" };
}
