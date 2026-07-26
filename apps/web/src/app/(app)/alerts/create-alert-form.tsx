"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SavedSearch, AlertKind } from "@dealradar/core";
import { createAlertInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { ALERT_KIND_LABELS } from "@/lib/labels";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function CreateAlertForm({ savedSearches }: { savedSearches: SavedSearch[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<AlertKind>("new_match");
  const [savedSearchId, setSavedSearchId] = useState(savedSearches[0]?.id ?? "");
  const [threshold, setThreshold] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (savedSearches.length === 0) {
    return (
      <p className="text-sm text-muted">
        Créez d&apos;abord une recherche sauvegardée depuis la page Recherche pour pouvoir y attacher une alerte.
      </p>
    );
  }

  async function handleCreate() {
    const parsed = createAlertInputSchema.safeParse({
      kind,
      savedSearchId,
      params:
        kind === "price_below" && threshold
          ? { thresholdCents: Math.round(Number(threshold) * 100) }
          : {},
    });
    if (!parsed.success) {
      setError("Formulaire invalide.");
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error: insertError } = await supabase.from("alerts").insert({
      user_id: user.id,
      kind: parsed.data.kind,
      saved_search_id: parsed.data.savedSearchId ?? null,
      listing_id: parsed.data.listingId ?? null,
      params: parsed.data.params,
    });
    setPending(false);
    if (insertError) {
      setError("Impossible de créer l'alerte.");
      return;
    }
    setThreshold("");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Type</label>
        <Select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} className="w-56">
          {Object.entries(ALERT_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted">Recherche sauvegardée</label>
        <Select value={savedSearchId} onChange={(e) => setSavedSearchId(e.target.value)} className="w-56">
          {savedSearches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      {kind === "price_below" ? (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Seuil (CHF)</label>
          <Input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-32"
          />
        </div>
      ) : null}
      <Button onClick={handleCreate} disabled={pending}>
        {pending ? "Création…" : "Créer l'alerte"}
      </Button>
      {error ? <p className="text-sm text-down">{error}</p> : null}
    </div>
  );
}
