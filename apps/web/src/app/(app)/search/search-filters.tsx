"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Category, Brand, SearchQuery } from "@dealradar/core";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CONDITION_OPTIONS } from "@/lib/labels";

const VERDICTS = [
  { value: "buy", label: "Acheter" },
  { value: "wait", label: "Attendre" },
  { value: "sell", label: "Vendre" },
] as const;

export function SearchFilters({
  categories,
  brands,
  initial,
}: {
  categories: Category[];
  brands: Brand[];
  initial: SearchQuery;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [categoryPath, setCategoryPath] = useState(initial.categoryPath ?? "");
  const [brandSlug, setBrandSlug] = useState(initial.brandSlug ?? "");
  const [condition, setCondition] = useState(initial.condition ?? "");
  const [minPrice, setMinPrice] = useState(
    initial.minPriceCents != null ? String(initial.minPriceCents / 100) : "",
  );
  const [maxPrice, setMaxPrice] = useState(
    initial.maxPriceCents != null ? String(initial.maxPriceCents / 100) : "",
  );
  const [verdict, setVerdict] = useState(initial.verdict ?? "");

  function submit() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (categoryPath) params.set("categoryPath", categoryPath);
    if (brandSlug) params.set("brandSlug", brandSlug);
    if (condition) params.set("condition", condition);
    if (minPrice) params.set("minPriceCents", String(Math.round(Number(minPrice) * 100)));
    if (maxPrice) params.set("maxPriceCents", String(Math.round(Number(maxPrice) * 100)));
    if (verdict) params.set("verdict", verdict);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface p-4 lg:grid-cols-4">
      <Input
        placeholder="Rechercher une annonce…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="col-span-2"
      />
      <Select value={categoryPath} onChange={(e) => setCategoryPath(e.target.value)}>
        <option value="">Toutes catégories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.path}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select value={brandSlug} onChange={(e) => setBrandSlug(e.target.value)}>
        <option value="">Toutes marques</option>
        {brands.map((b) => (
          <option key={b.id} value={b.slug}>
            {b.name}
          </option>
        ))}
      </Select>
      <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
        <option value="">État : tous</option>
        {CONDITION_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <Input
        type="number"
        placeholder="Prix min (CHF)"
        value={minPrice}
        onChange={(e) => setMinPrice(e.target.value)}
      />
      <Input
        type="number"
        placeholder="Prix max (CHF)"
        value={maxPrice}
        onChange={(e) => setMaxPrice(e.target.value)}
      />
      <Select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
        <option value="">Verdict : tous</option>
        {VERDICTS.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </Select>
      <Button onClick={submit}>Rechercher</Button>
    </div>
  );
}
