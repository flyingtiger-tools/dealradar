import type { SupabaseClient } from "@supabase/supabase-js";
import { toResearchTargetRow, type RawResearchTargetRow, type ResearchTargetRow } from "./research-target-model";

/**
 * Lecture SEULE (LOT "Close the Refresh Loop", section 1) — aperçu des
 * cibles dues, sans réclamer aucun bail. L'ordre reflète exactement celui
 * de `claim_research_target` (migration 0021) pour que la prévisualisation
 * et l'acquisition réelle restent cohérentes : priorité décroissante, puis
 * la plus ancienne échéance d'abord (jamais rafraîchie = `epoch`).
 *
 * Ne renvoie jamais une cible désactivée ou dont l'échéance est future.
 */
export interface QueryDueResearchTargetsOptions {
  limit: number;
  /** Horloge injectable pour les tests — par défaut `new Date()`. */
  now?: Date;
}

export async function queryDueResearchTargets(
  supabase: SupabaseClient,
  options: QueryDueResearchTargetsOptions,
): Promise<ResearchTargetRow[]> {
  const nowIso = (options.now ?? new Date()).toISOString();
  const { data, error } = await supabase
    .from("research_targets")
    .select("*")
    .eq("enabled", true)
    .or(`next_refresh_at.lte.${nowIso},next_refresh_at.is.null`)
    .order("priority", { ascending: false })
    .order("next_refresh_at", { ascending: true, nullsFirst: true })
    .limit(options.limit);

  if (error) {
    throw new Error(`Lecture des cibles de recherche dues impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }
  return ((data as RawResearchTargetRow[] | null) ?? []).map(toResearchTargetRow);
}
