import type { SupabaseClient } from "@supabase/supabase-js";
import { toResearchTargetRow, type RawResearchTargetRow, type ResearchTargetRow } from "./research-target-model";

/**
 * Enveloppes typées autour des RPC `claim_research_target`/`release_research_target`
 * (migration 0021 — LOT "Close the Refresh Loop", section 2). Toute la logique
 * d'atomicité vit dans la RPC Postgres ; ce module ne fait que sérialiser les
 * paramètres et désérialiser les lignes retournées.
 */
export interface ClaimResearchTargetsOptions {
  /** Identifiant libre du bailleur (ex. id de process workers) — jamais un secret. */
  leaseOwner: string;
  leaseDurationSeconds: number;
  /** Nombre max de cibles à réclamer en un appel — défaut 1. */
  limit?: number;
}

export async function claimResearchTargets(
  supabase: SupabaseClient,
  options: ClaimResearchTargetsOptions,
): Promise<ResearchTargetRow[]> {
  const { data, error } = await supabase.rpc("claim_research_target", {
    p_lease_owner: options.leaseOwner,
    p_lease_duration_seconds: options.leaseDurationSeconds,
    p_limit: options.limit ?? 1,
  });

  if (error) {
    throw new Error(`Acquisition de bail impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }
  return ((data as RawResearchTargetRow[] | null) ?? []).map(toResearchTargetRow);
}

/**
 * Libération propre d'un bail détenu. Renvoie `false` (jamais une exception)
 * quand ce bailleur ne détient plus le bail — ex. il a déjà expiré et a été
 * repris par un autre worker ; l'appelant ne doit pas traiter ce cas comme une
 * erreur fatale, seulement journaliser un diagnostic (LOT, section 3).
 */
export async function releaseResearchTarget(
  supabase: SupabaseClient,
  targetId: number,
  leaseOwner: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("release_research_target", {
    p_target_id: targetId,
    p_lease_owner: leaseOwner,
  });

  if (error) {
    throw new Error(`Libération de bail impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }
  return Boolean(data);
}
