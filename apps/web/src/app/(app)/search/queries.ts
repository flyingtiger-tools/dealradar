import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchQuery } from "@dealradar/core";
import { listingSummaryRowSchema, type ListingSummary } from "@/lib/supabase/listings";

export async function fetchListings(
  supabase: SupabaseClient,
  query: SearchQuery,
): Promise<{ listings: ListingSummary[] }> {
  let categoryId: string | undefined;
  if (query.categoryPath) {
    const { data } = await supabase
      .from("categories")
      .select("id")
      .eq("path", query.categoryPath)
      .maybeSingle();
    categoryId = data?.id;
  }

  let brandId: string | undefined;
  if (query.brandSlug) {
    const { data } = await supabase.from("brands").select("id").eq("slug", query.brandSlug).maybeSingle();
    brandId = data?.id;
  }

  let builder = supabase
    .from("listings")
    .select("id,title,price_cents,currency,condition,categories(name,path),brands(name,slug)")
    .eq("status", "active");

  if (query.q) builder = builder.textSearch("search_tsv", query.q, { type: "websearch", config: "french" });
  if (categoryId) builder = builder.eq("category_id", categoryId);
  if (brandId) builder = builder.eq("brand_id", brandId);
  if (query.condition) builder = builder.eq("condition", query.condition);
  if (query.minPriceCents != null) builder = builder.gte("price_cents", query.minPriceCents);
  if (query.maxPriceCents != null) builder = builder.lte("price_cents", query.maxPriceCents);

  const from = (query.page - 1) * query.perPage;
  const { data } = await builder.range(from, from + query.perPage - 1);

  return {
    listings: (data ?? []).map((row) => listingSummaryRowSchema.parse(row)),
  };
}
