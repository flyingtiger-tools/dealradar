"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WatchlistItem } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, formatDate } from "@/lib/format";
import { Verdict } from "@/components/ui/verdict";
import { Button } from "@/components/ui/button";
import type { ListingSummary, DealScore } from "@/lib/supabase/listings";

export function WatchlistItemRow({
  item,
  score,
}: {
  item: WatchlistItem & { listing: ListingSummary | null };
  score: DealScore | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleRemove() {
    setPending(true);
    const supabase = createClient();
    await supabase
      .from("watchlist_items")
      .delete()
      .eq("watchlist_id", item.watchlistId)
      .eq("listing_id", item.listingId);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.listing?.title ?? "Annonce indisponible"}</p>
        <p className="font-data text-xs text-muted tabular-nums">
          {item.listing ? formatPrice(item.listing.priceCents, item.listing.currency) : "—"} · ajouté{" "}
          {formatDate(item.addedAt)}
        </p>
        {item.note ? <p className="text-xs text-muted">{item.note}</p> : null}
      </div>
      {score?.verdict ? <Verdict value={score.verdict} /> : null}
      <Button variant="danger" size="sm" onClick={handleRemove} disabled={pending}>
        Retirer
      </Button>
    </div>
  );
}
