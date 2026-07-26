import type { Metadata } from "next";
import { watchlistRowSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateWatchlistForm } from "./create-watchlist-form";
import { WatchlistCard } from "./watchlist-card";

export const metadata: Metadata = { title: "Watchlists" };

export default async function WatchlistsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("watchlists")
    .select("id,user_id,name,created_at,updated_at,watchlist_items(count)")
    .order("updated_at", { ascending: false });
  const watchlists = (data ?? []).map((row) => watchlistRowSchema.parse(row));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Watchlists</h1>
        <CreateWatchlistForm />
      </div>
      {watchlists.length === 0 ? (
        <EmptyState
          title="Aucune watchlist"
          description="Regroupez les annonces que vous suivez. Chaque liste affiche les verdicts et les mouvements de prix en continu."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {watchlists.map((w) => (
            <WatchlistCard key={w.id} watchlist={w} />
          ))}
        </div>
      )}
    </div>
  );
}
