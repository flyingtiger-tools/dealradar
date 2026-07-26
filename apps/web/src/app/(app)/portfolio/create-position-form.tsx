"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Category, Brand } from "@dealradar/core";
import { createPortfolioPositionInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CONDITION_OPTIONS } from "@/lib/labels";

export function CreatePositionForm({ categories, brands }: { categories: Category[]; brands: Brand[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [condition, setCondition] = useState("");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [acquiredPrice, setAcquiredPrice] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const parsed = createPortfolioPositionInputSchema.safeParse({
      title,
      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      condition: condition || undefined,
      acquiredAt: acquiredAt || undefined,
      acquiredPriceCents: acquiredPrice ? Math.round(Number(acquiredPrice) * 100) : undefined,
    });
    if (!parsed.success) {
      setError("Le titre est requis (1 à 300 caractères).");
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error: insertError } = await supabase.from("portfolio_positions").insert({
      user_id: user.id,
      title: parsed.data.title,
      category_id: parsed.data.categoryId ?? null,
      brand_id: parsed.data.brandId ?? null,
      condition: parsed.data.condition ?? null,
      acquired_at: parsed.data.acquiredAt ?? null,
      acquired_price_cents: parsed.data.acquiredPriceCents ?? null,
      currency: "CHF",
    });
    setPending(false);
    if (insertError) {
      setError("Impossible d'ajouter cet objet.");
      return;
    }
    setTitle("");
    setCategoryId("");
    setBrandId("");
    setCondition("");
    setAcquiredAt("");
    setAcquiredPrice("");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Ajouter un objet
      </Button>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 lg:grid-cols-3">
      <Input
        placeholder="Titre"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="col-span-2 lg:col-span-1"
      />
      <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">Catégorie</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
        <option value="">Marque</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
        <option value="">État</option>
        {CONDITION_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <Input type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} />
      <Input
        type="number"
        placeholder="Prix d'achat (CHF)"
        value={acquiredPrice}
        onChange={(e) => setAcquiredPrice(e.target.value)}
      />
      <div className="col-span-2 flex items-center gap-2 lg:col-span-3">
        <Button size="sm" onClick={handleCreate} disabled={pending}>
          {pending ? "Ajout…" : "Ajouter"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
        {error ? <p className="text-sm text-down">{error}</p> : null}
      </div>
    </div>
  );
}
