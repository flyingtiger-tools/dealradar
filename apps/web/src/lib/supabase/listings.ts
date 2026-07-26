import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemConditionSchema, type Verdict } from "@dealradar/core";

/** Forme minimale d'une annonce utilisée en liste (résultats de recherche, items de watchlist). */
export const listingSummaryRowSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    price_cents: z.number(),
    currency: z.string(),
    condition: itemConditionSchema.nullable(),
    categories: z.object({ name: z.string(), path: z.string() }).nullable(),
    brands: z.object({ name: z.string(), slug: z.string() }).nullable(),
  })
  .transform((r) => ({
    id: r.id,
    title: r.title,
    priceCents: r.price_cents,
    currency: r.currency,
    condition: r.condition,
    categoryName: r.categories?.name ?? null,
    brandName: r.brands?.name ?? null,
  }));
export type ListingSummary = z.infer<typeof listingSummaryRowSchema>;

export type DealScore = { value: number; verdict: Verdict | null };

/**
 * `latest_scores` est une vue sans FK vers `listings` : PostgREST ne peut pas
 * l'embarquer dans un select imbriqué, d'où ce fetch séparé + merge en mémoire.
 */
export async function fetchLatestDealScores(
  supabase: SupabaseClient,
  listingIds: string[],
): Promise<Map<string, DealScore>> {
  const map = new Map<string, DealScore>();
  if (listingIds.length === 0) return map;
  const { data } = await supabase
    .from("latest_scores")
    .select("listing_id,value,verdict")
    .eq("score_type", "deal")
    .in("listing_id", listingIds);
  for (const row of data ?? []) {
    map.set(row.listing_id as string, { value: row.value as number, verdict: row.verdict as Verdict | null });
  }
  return map;
}
