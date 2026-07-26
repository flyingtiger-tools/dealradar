"use client";

import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Watchlist } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

export function WatchlistCard({ watchlist }: { watchlist: Watchlist }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Supprimer la watchlist « ${watchlist.name} » ?`)) return;
    setPending(true);
    const supabase = createClient();
    await supabase.from("watchlists").delete().eq("id", watchlist.id);
    router.refresh();
  }

  const count = watchlist.itemCount ?? 0;

  return (
    <Link href={`/watchlists/${watchlist.id}`}>
      <Card className="transition-colors hover:bg-raised">
        <CardBody className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{watchlist.name}</p>
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={pending}>
              Supprimer
            </Button>
          </div>
          <p className="font-data text-xs text-muted tabular-nums">
            {count} annonce{count > 1 ? "s" : ""} · mise à jour {formatDate(watchlist.updatedAt)}
          </p>
        </CardBody>
      </Card>
    </Link>
  );
}
