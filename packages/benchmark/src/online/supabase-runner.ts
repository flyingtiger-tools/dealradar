import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEbayItem } from "@dealradar/connectors";
import { persistListing, extractListing, analyzeListing, normalizedListingSchema } from "@dealradar/ingestion";
import type { AIProvider } from "@dealradar/ai";
import type { Dataset } from "../dataset/schema";
import { DEFAULT_COST_ASSUMPTIONS } from "../pipeline/cost-assumptions";

export const BENCHMARK_SOURCE_SLUG = "benchmark";

/**
 * Source Supabase dédiée et isolée pour le mode `--online` — jamais
 * réutilisée par un connecteur réel (eBay utilise `sources.slug = "ebay"`).
 * `is_active: false` : n'apparaît jamais dans un déclenchement d'ingestion
 * normal (admin/CLI workers).
 */
export async function ensureBenchmarkSource(supabase: SupabaseClient): Promise<string> {
  const { data: existing } = await supabase.from("sources").select("id").eq("slug", BENCHMARK_SOURCE_SLUG).maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const { data: inserted, error } = await supabase
    .from("sources")
    .insert({ slug: BENCHMARK_SOURCE_SLUG, name: "Benchmark (Lot 6)", base_url: "https://benchmark.internal", country: "CH", is_active: false })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(`Impossible de créer la source benchmark dédiée : ${error?.message ?? "erreur inconnue"}`);
  }
  return (inserted as { id: string }).id;
}

export interface OnlineRunResult {
  listingIds: string[];
  timingsMs: { persist: number[]; extract: number[]; analyze: number[] };
}

/**
 * Exécute la pipeline d'ingestion réelle (persist/extract/analyze,
 * inchangées, `@dealradar/ingestion`) contre le projet Supabase configuré,
 * sous la source `benchmark` dédiée. Le pool de comparables du dataset est
 * persisté comme des annonces déjà vendues (`status: "sold"`) — seule
 * façon d'exercer Intelligence Core au-delà de INSUFFICIENT_DATA en mode
 * en ligne, sans modifier `persist-listing.ts`.
 */
export async function runDatasetOnline(
  supabase: SupabaseClient,
  dataset: Dataset,
  options: { provider?: AIProvider; asOf: string },
): Promise<OnlineRunResult> {
  const sourceId = await ensureBenchmarkSource(supabase);
  const listingIds: string[] = [];
  const timingsMs = { persist: [] as number[], extract: [] as number[], analyze: [] as number[] };

  for (const comparable of dataset.comparables) {
    const normalized = normalizeEbayItem(comparable.raw, { categorySlug: dataset.categorySlug, collectedAt: options.asOf });
    if (!normalized) continue;
    const parsed = normalizedListingSchema.safeParse(normalized);
    if (!parsed.success) continue;
    const persisted = await persistListing(supabase, sourceId, parsed.data);
    listingIds.push(persisted.listingId);
    await supabase.from("listings").update({ status: "sold", sold_at: comparable.soldAt }).eq("id", persisted.listingId);
  }

  for (const item of dataset.items) {
    const normalized = normalizeEbayItem(item.raw, { categorySlug: dataset.categorySlug, collectedAt: options.asOf });
    if (!normalized) continue;
    const parsed = normalizedListingSchema.safeParse(normalized);
    if (!parsed.success) continue;

    const persistStart = performance.now();
    const persisted = await persistListing(supabase, sourceId, parsed.data);
    timingsMs.persist.push(performance.now() - persistStart);
    listingIds.push(persisted.listingId);

    const extractStart = performance.now();
    await extractListing({ supabase, listingId: persisted.listingId, provider: options.provider });
    timingsMs.extract.push(performance.now() - extractStart);

    const { data: row } = await supabase.from("listings").select("price_cents").eq("id", persisted.listingId).maybeSingle();
    const priceCents = (row as { price_cents: number } | null)?.price_cents ?? 0;

    const analyzeStart = performance.now();
    await analyzeListing({
      supabase,
      listingId: persisted.listingId,
      costs: { purchasePriceCents: priceCents, ...DEFAULT_COST_ASSUMPTIONS },
      asOf: options.asOf,
    });
    timingsMs.analyze.push(performance.now() - analyzeStart);
  }

  return { listingIds, timingsMs };
}
