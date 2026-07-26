"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Watchlist } from "@dealradar/core";
import { createWatchlistInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function WatchlistHeaderActions({ watchlist }: { watchlist: Watchlist }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(watchlist.name);
  const [pending, setPending] = useState(false);

  async function handleRename() {
    const parsed = createWatchlistInputSchema.safeParse({ name });
    if (!parsed.success) return;
    setPending(true);
    const supabase = createClient();
    await supabase.from("watchlists").update({ name: parsed.data.name }).eq("id", watchlist.id);
    setPending(false);
    setRenaming(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(`Supprimer la watchlist « ${watchlist.name} » ?`)) return;
    const supabase = createClient();
    await supabase.from("watchlists").delete().eq("id", watchlist.id);
    router.push("/watchlists");
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={handleRename} disabled={pending}>
          Enregistrer
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
          Annuler
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => setRenaming(true)}>
        Renommer
      </Button>
      <Button size="sm" variant="danger" onClick={handleDelete}>
        Supprimer
      </Button>
    </div>
  );
}
