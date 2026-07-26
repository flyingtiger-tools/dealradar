"use client";

import { useState } from "react";
import type { SearchQuery } from "@dealradar/core";
import { createSavedSearchInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function SaveSearchButton({ query }: { query: SearchQuery }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const parsed = createSavedSearchInputSchema.safeParse({ name, query });
    if (!parsed.success) {
      setError("Donnez un nom à cette recherche (1 à 100 caractères).");
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error: insertError } = await supabase.from("saved_searches").insert({
      user_id: user.id,
      name: parsed.data.name,
      query: parsed.data.query,
    });
    setPending(false);
    if (insertError) {
      setError("Impossible d'enregistrer la recherche.");
      return;
    }
    setSaved(true);
    setOpen(false);
  }

  if (saved) return <p className="text-sm text-up">Recherche enregistrée — créez une alerte depuis la page Alertes.</p>;

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Sauvegarder cette recherche
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Nom de la recherche"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="max-w-xs"
      />
      <Button size="sm" onClick={handleSave} disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
      {error ? <p className="text-sm text-down">{error}</p> : null}
    </div>
  );
}
