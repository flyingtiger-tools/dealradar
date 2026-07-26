import type { Metadata } from "next";
import { searchQuerySchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/server";
import { fetchCategories, fetchBrands } from "@/lib/supabase/taxonomy";
import { fetchLatestDealScores } from "@/lib/supabase/listings";
import { EmptyState } from "@/components/ui/empty-state";
import { fetchListings } from "./queries";
import { SearchFilters } from "./search-filters";
import { SaveSearchButton } from "./save-search-button";
import { SearchResultRow } from "./search-result-row";

export const metadata: Metadata = { title: "Recherche" };

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const query = searchQuerySchema.parse({
    q: first(raw.q),
    categoryPath: first(raw.categoryPath),
    brandSlug: first(raw.brandSlug),
    condition: first(raw.condition),
    minPriceCents: first(raw.minPriceCents) ? Number(first(raw.minPriceCents)) : undefined,
    maxPriceCents: first(raw.maxPriceCents) ? Number(first(raw.maxPriceCents)) : undefined,
    verdict: first(raw.verdict),
    page: first(raw.page) ? Number(first(raw.page)) : undefined,
    perPage: first(raw.perPage) ? Number(first(raw.perPage)) : undefined,
  });

  const supabase = await createClient();
  const [categories, brands, { data: watchlistRows }] = await Promise.all([
    fetchCategories(supabase),
    fetchBrands(supabase),
    supabase.from("watchlists").select("id,name").order("name"),
  ]);
  const watchlists = watchlistRows ?? [];

  const { listings } = await fetchListings(supabase, query);
  const scores = await fetchLatestDealScores(
    supabase,
    listings.map((l) => l.id),
  );

  const results = query.verdict
    ? listings.filter((l) => scores.get(l.id)?.verdict === query.verdict)
    : listings;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Recherche</h1>
        <SaveSearchButton query={query} />
      </div>

      <SearchFilters categories={categories} brands={brands} initial={query} />

      {results.length === 0 ? (
        <EmptyState
          title="Aucune annonce ne correspond"
          description="Le marché est vide pour l'instant : le pipeline d'ingestion (Lot 3) alimentera les annonces en continu. Vos filtres et recherches sauvegardées sont déjà prêts à s'en servir."
        />
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {results.map((listing) => (
            <SearchResultRow
              key={listing.id}
              listing={listing}
              score={scores.get(listing.id) ?? null}
              watchlists={watchlists}
            />
          ))}
        </div>
      )}
    </div>
  );
}
