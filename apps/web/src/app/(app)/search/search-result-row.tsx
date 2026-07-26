"use client";

import { useState } from "react";
import Link from "next/link";
import { addWatchlistItemInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/format";
import { Verdict } from "@/components/ui/verdict";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { ListingSummary, DealScore } from "@/lib/supabase/listings";

type Status = "idle" | "pending" | "added" | "exists" | "error";

export function SearchResultRow({
  listing,
  score,
  watchlists,
}: {
  listing: ListingSummary;
  score: DealScore | null;
  watchlists: { id: string; name: string }[];
}) {
  const [watchlistId, setWatchlistId] = useState(watchlists[0]?.id ?? "");
  const [status, setStatus] = useState<Status>("idle");

  async function handleAdd() {
    const parsed = addWatchlistItemInputSchema.safeParse({ listingId: listing.id });
    if (!parsed.success || !watchlistId) return;
    setStatus("pending");
    const supabase = createClient();
    const { error } = await supabase.from("watchlist_items").insert({
      watchlist_id: watchlistId,
      listing_id: parsed.data.listingId,
    });
    setStatus(error ? (error.code === "23505" ? "exists" : "error") : "added");
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{listing.title}</p>
        <p className="font-data text-xs text-muted tabular-nums">
          {formatPrice(listing.priceCents, listing.currency)}
          {listing.brandName ? ` · ${listing.brandName}` : ""}
          {listing.categoryName ? ` · ${listing.categoryName}` : ""}
        </p>
      </div>
      {score?.verdict ? <Verdict value={score.verdict} /> : null}
      {watchlists.length === 0 ? (
        <Link href="/watchlists" className="text-xs text-muted underline underline-offset-4">
          Créer une watchlist
        </Link>
      ) : status === "added" ? (
        <span className="text-xs text-up">Ajouté</span>
      ) : status === "exists" ? (
        <span className="text-xs text-muted">Déjà dans cette liste</span>
      ) : status === "error" ? (
        <span className="text-xs text-down">Erreur</span>
      ) : (
        <div className="flex items-center gap-2">
          <Select value={watchlistId} onChange={(e) => setWatchlistId(e.target.value)} className="w-40">
            {watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" onClick={handleAdd} disabled={status === "pending"}>
            Ajouter
          </Button>
        </div>
      )}
    </div>
  );
}
