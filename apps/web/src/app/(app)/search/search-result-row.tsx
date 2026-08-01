"use client";

import { useState } from "react";
import Link from "next/link";
import { addWatchlistItemInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/format";
import { Verdict } from "@/components/ui/verdict";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { ListRow } from "@/components/ui/list-row";
import { useMountTransition } from "@/lib/use-mount-transition";
import { cn } from "@/lib/cn";
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
  const resolved = status === "added" || status === "exists" || status === "error";
  const resolvedMounted = useMountTransition([status]);

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
    <ListRow className="relative">
      {/* Ligne entière cliquable vers le détail, sauf les actions ci-dessous (select/bouton/lien
          watchlist) qui réactivent pointer-events localement — même motif que WatchlistCard. */}
      <Link href={`/search/${listing.id}`} aria-label={listing.title} className="absolute inset-0" />
      <div className="pointer-events-none min-w-0 flex-1">
        <p className="truncate text-sm">{listing.title}</p>
        <p className="font-data text-xs text-muted tabular-nums">
          {formatPrice(listing.priceCents, listing.currency)}
          {listing.brandName ? ` · ${listing.brandName}` : ""}
          {listing.categoryName ? ` · ${listing.categoryName}` : ""}
        </p>
      </div>
      {score?.verdict ? <Verdict value={score.verdict} className="pointer-events-none" /> : null}
      {watchlists.length === 0 ? (
        <Link
          href="/watchlists"
          className="pointer-events-auto relative z-10 inline-block py-2 text-xs text-muted underline underline-offset-4"
        >
          Créer une watchlist
        </Link>
      ) : resolved ? (
        <span
          className={cn(
            "pointer-events-none motion-safe:transition-[opacity,transform] motion-safe:duration-150 motion-safe:ease-out",
            resolvedMounted ? "opacity-100 motion-safe:scale-100" : "opacity-0 motion-safe:scale-95",
          )}
        >
          {status === "added" ? (
            <InlineNotice tone="success">Ajouté</InlineNotice>
          ) : status === "exists" ? (
            <InlineNotice tone="info">Déjà dans cette liste</InlineNotice>
          ) : (
            <InlineNotice tone="error">Erreur</InlineNotice>
          )}
        </span>
      ) : (
        <div className="pointer-events-auto relative z-10 flex items-center gap-2">
          <Select aria-label="Watchlist" value={watchlistId} onChange={(e) => setWatchlistId(e.target.value)} className="w-40">
            {watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" onClick={handleAdd} loading={status === "pending"}>
            Ajouter
          </Button>
        </div>
      )}
    </ListRow>
  );
}
