import type { SupabaseClient } from "@supabase/supabase-js";
import type { HistoricalPricePoint } from "@dealradar/core";

/**
 * Lit l'historique de prix persisté (`market_observations`, migration
 * 0018) pour UN produit sur une fenêtre de lookback — alimente
 * `computeVolatility`/`computeTrend` (`@dealradar/core`) côté
 * `persist-market-snapshot-summary.ts` (LOT "Close the Refresh Loop",
 * section 10). Un seul cycle ne permet jamais de juger une tendance —
 * cette lecture couvre volontairement PLUSIEURS cycles passés, jamais
 * seulement le cycle courant.
 */
export interface QueryHistoricalPricePointsOptions {
  sinceIso: string;
  limit?: number;
}

interface RawObservationPricePoint {
  observed_at: string;
  price_cents: number;
  source: string;
}

export async function queryHistoricalPricePoints(
  supabase: SupabaseClient,
  productKey: string,
  options: QueryHistoricalPricePointsOptions,
): Promise<HistoricalPricePoint[]> {
  const { data, error } = await supabase
    .from("market_observations")
    .select("observed_at, price_cents, source")
    .eq("product_key", productKey)
    .gte("observed_at", options.sinceIso)
    .order("observed_at", { ascending: true })
    .limit(options.limit ?? 500);

  if (error) {
    throw new Error(`Lecture de l'historique de prix impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }

  return ((data as RawObservationPricePoint[] | null) ?? []).map((row) => ({
    observedAt: row.observed_at,
    priceCents: row.price_cents,
    source: row.source,
  }));
}
