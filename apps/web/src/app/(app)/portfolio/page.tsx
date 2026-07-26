import type { Metadata } from "next";
import { portfolioPositionRowSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/server";
import { fetchCategories, fetchBrands } from "@/lib/supabase/taxonomy";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardBody } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { formatPrice } from "@/lib/format";
import { CreatePositionForm } from "./create-position-form";
import { PositionRow } from "./position-row";

export const metadata: Metadata = { title: "Portfolio" };

/** Cf. apps/web/src/app/(app)/alerts/page.tsx : embeds many-to-one non typés sans Database généré. */
type RawPositionRow = {
  id: string;
  user_id: string;
  title: string;
  category_id: string | null;
  brand_id: string | null;
  condition: string | null;
  acquired_at: string | null;
  acquired_price_cents: number | null;
  currency: string;
  source_listing_id: string | null;
  status: string;
  sold_at: string | null;
  sold_price_cents: number | null;
  created_at: string;
  updated_at: string;
  categories: { name: string } | null;
  brands: { name: string } | null;
};

export default async function PortfolioPage() {
  const supabase = await createClient();
  const [categories, brands, { data: rows }] = await Promise.all([
    fetchCategories(supabase),
    fetchBrands(supabase),
    supabase
      .from("portfolio_positions")
      .select(
        "id,user_id,title,category_id,brand_id,condition,acquired_at,acquired_price_cents,currency,source_listing_id,status,sold_at,sold_price_cents,created_at,updated_at,categories(name),brands(name)",
      )
      .order("created_at", { ascending: false }),
  ]);

  const positions = ((rows ?? []) as unknown as RawPositionRow[]).map((row) => ({
    ...portfolioPositionRowSchema.parse(row),
    categoryName: row.categories?.name ?? null,
    brandName: row.brands?.name ?? null,
  }));

  const held = positions.filter((p) => p.status !== "sold");
  const sold = positions.filter((p) => p.status === "sold");
  const heldValueCents = held.reduce((sum, p) => sum + (p.acquiredPriceCents ?? 0), 0);
  const soldValueCents = sold.reduce((sum, p) => sum + (p.soldPriceCents ?? 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Portfolio</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardBody>
            <Stat label="Objets détenus" value={String(held.length)} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Valeur d'acquisition détenue" value={formatPrice(heldValueCents)} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Objets vendus" value={String(sold.length)} />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Valeur des ventes" value={formatPrice(soldValueCents)} />
          </CardBody>
        </Card>
      </div>

      <CreatePositionForm categories={categories} brands={brands} />

      {positions.length === 0 ? (
        <EmptyState
          title="Votre portfolio est vide"
          description="Ajoutez ce que vous possédez : DealRadar suit la valeur de revente et vous dit quand vendre."
        />
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {positions.map((p) => (
            <PositionRow key={p.id} position={p} />
          ))}
        </div>
      )}
    </div>
  );
}
