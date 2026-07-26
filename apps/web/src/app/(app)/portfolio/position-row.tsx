"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PortfolioPosition, PortfolioStatus } from "@dealradar/core";
import { markPositionSoldInputSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, formatDate } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const STATUS_LABELS: Record<PortfolioStatus, string> = {
  held: "Détenu",
  listed: "En vente",
  sold: "Vendu",
};

type PositionRowData = PortfolioPosition & { categoryName: string | null; brandName: string | null };

export function PositionRow({ position }: { position: PositionRowData }) {
  const router = useRouter();
  const [selling, setSelling] = useState(false);
  const [soldAt, setSoldAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [soldPrice, setSoldPrice] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMarkSold() {
    const parsed = markPositionSoldInputSchema.safeParse({
      soldAt,
      soldPriceCents: soldPrice ? Math.round(Number(soldPrice) * 100) : Number.NaN,
    });
    if (!parsed.success) {
      setError("Date et prix de vente requis.");
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("portfolio_positions")
      .update({ status: "sold", sold_at: parsed.data.soldAt, sold_price_cents: parsed.data.soldPriceCents })
      .eq("id", position.id);
    setPending(false);
    if (updateError) {
      setError("Impossible de marquer comme vendu.");
      return;
    }
    router.refresh();
  }

  async function handleDelete() {
    setPending(true);
    const supabase = createClient();
    await supabase.from("portfolio_positions").delete().eq("id", position.id);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{position.title}</p>
        <p className="font-data text-xs text-muted tabular-nums">
          {STATUS_LABELS[position.status]}
          {position.acquiredPriceCents != null
            ? ` · acquis ${formatPrice(position.acquiredPriceCents, position.currency)}`
            : ""}
          {position.acquiredAt ? ` le ${formatDate(position.acquiredAt)}` : ""}
          {position.status === "sold" && position.soldPriceCents != null
            ? ` · vendu ${formatPrice(position.soldPriceCents, position.currency)} le ${formatDate(position.soldAt)}`
            : ""}
          {position.brandName ? ` · ${position.brandName}` : ""}
          {position.categoryName ? ` · ${position.categoryName}` : ""}
        </p>
        {error ? <p className="text-xs text-down">{error}</p> : null}
      </div>
      {position.status !== "sold" ? (
        selling ? (
          <div className="flex items-center gap-2">
            <Input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} className="w-36" />
            <Input
              type="number"
              placeholder="Prix (CHF)"
              value={soldPrice}
              onChange={(e) => setSoldPrice(e.target.value)}
              className="w-28"
            />
            <Button size="sm" onClick={handleMarkSold} disabled={pending}>
              Confirmer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelling(false)}>
              Annuler
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setSelling(true)}>
            Marquer vendu
          </Button>
        )
      ) : null}
      <Button size="sm" variant="danger" onClick={handleDelete} disabled={pending}>
        Supprimer
      </Button>
    </div>
  );
}
