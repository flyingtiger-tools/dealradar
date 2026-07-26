"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createWatchlistInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function CreateWatchlistForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const parsed = createWatchlistInputSchema.safeParse({ name });
    if (!parsed.success) {
      setError("Le nom doit contenir 1 à 100 caractères.");
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error: insertError } = await supabase
      .from("watchlists")
      .insert({ user_id: user.id, name: parsed.data.name });
    setPending(false);
    if (insertError) {
      setError("Impossible de créer la watchlist.");
      return;
    }
    setName("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Nouvelle watchlist
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder="Nom de la liste"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="max-w-xs"
      />
      <Button size="sm" onClick={handleCreate} disabled={pending}>
        {pending ? "Création…" : "Créer"}
      </Button>
      {error ? <p className="text-sm text-down">{error}</p> : null}
    </div>
  );
}
