"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { triggerIngestion } from "./actions";

const CATEGORY_OPTIONS = [
  { value: "lego", label: "LEGO" },
  { value: "pokemon_tcg", label: "Pokémon / TCG" },
  { value: "apple", label: "Apple" },
  { value: "gaming", label: "Gaming" },
  { value: "photo", label: "Photo" },
] as const;

export function TriggerIngestionForm() {
  const router = useRouter();
  const [categorySlug, setCategorySlug] = useState<string>("lego");
  const [q, setQ] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setPending(true);
    setError(null);
    setMessage(null);
    const result = await triggerIngestion({ categorySlug, q });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(
      "Job envoyé à la file ingest.source. Le traitement est asynchrone — il faut que le worker tourne pour le traiter. Rafraîchissez cette page dans quelques secondes pour voir le run et les annonces.",
    );
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Catégorie</label>
        <Select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className="w-48">
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Requête eBay</label>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ex. lego star wars"
          className="w-64"
        />
      </div>
      <Button onClick={handleSubmit} disabled={pending || q.trim().length === 0}>
        {pending ? "Envoi…" : "Lancer une ingestion"}
      </Button>
      {message ? <p className="max-w-md text-sm text-up">{message}</p> : null}
      {error ? <p className="max-w-md text-sm text-down">{error}</p> : null}
    </div>
  );
}
