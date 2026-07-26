import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { watchlistRowSchema, watchlistItemRowSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/server";
import { fetchLatestDealScores, listingSummaryRowSchema } from "@/lib/supabase/listings";
import { EmptyState } from "@/components/ui/empty-state";
import { WatchlistHeaderActions } from "./watchlist-header-actions";
import { WatchlistItemRow } from "./watchlist-item-row";

export const metadata: Metadata = { title: "Watchlist" };

export default async function WatchlistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: watchlistRow }, { data: itemRows }] = await Promise.all([
    supabase.from("watchlists").select("id,user_id,name,created_at,updated_at").eq("id", id).maybeSingle(),
    supabase
      .from("watchlist_items")
      .select(
        "watchlist_id,listing_id,note,added_at,listings(id,title,price_cents,currency,condition,categories(name,path),brands(name,slug))",
      )
      .eq("watchlist_id", id)
      .order("added_at", { ascending: false }),
  ]);
  if (!watchlistRow) notFound();
  const watchlist = watchlistRowSchema.parse(watchlistRow);

  const items = (itemRows ?? []).map((row) => ({
    ...watchlistItemRowSchema.parse({
      watchlist_id: row.watchlist_id,
      listing_id: row.listing_id,
      note: row.note,
      added_at: row.added_at,
    }),
    listing: row.listings ? listingSummaryRowSchema.parse(row.listings) : null,
  }));

  const scores = await fetchLatestDealScores(
    supabase,
    items.flatMap((i) => (i.listing ? [i.listing.id] : [])),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{watchlist.name}</h1>
        <WatchlistHeaderActions watchlist={watchlist} />
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="Watchlist vide"
          description="Ajoutez des annonces depuis la page Recherche pour les suivre ici."
        />
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {items.map((item) => (
            <WatchlistItemRow
              key={item.listingId}
              item={item}
              score={item.listing ? (scores.get(item.listing.id) ?? null) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
