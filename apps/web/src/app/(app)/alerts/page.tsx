import type { Metadata } from "next";
import { alertRowSchema, savedSearchRowSchema } from "@dealradar/core";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateAlertForm } from "./create-alert-form";
import { AlertRow } from "./alert-row";

export const metadata: Metadata = { title: "Alertes" };

/**
 * Sans types Database générés, supabase-js infère les embeds many-to-one
 * comme des tableaux — alors que PostgREST les renvoie en objet unique à
 * l'exécution (FK alerts.saved_search_id/listing_id → une seule ligne).
 * On recale le type sur la forme réelle plutôt que de faire confiance à l'inférence.
 */
type AlertRow = {
  id: string;
  user_id: string;
  kind: string;
  listing_id: string | null;
  saved_search_id: string | null;
  params: unknown;
  is_active: boolean;
  last_fired_at: string | null;
  created_at: string;
  saved_searches: { id: string; name: string } | null;
  listings: { id: string; title: string } | null;
};

export default async function AlertsPage() {
  const supabase = await createClient();

  const [{ data: alertRows }, { data: savedSearchRows }] = await Promise.all([
    supabase
      .from("alerts")
      .select(
        "id,user_id,kind,listing_id,saved_search_id,params,is_active,last_fired_at,created_at,saved_searches(id,name),listings(id,title)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("saved_searches")
      .select("id,user_id,name,query,created_at")
      .order("created_at", { ascending: false }),
  ]);

  const savedSearches = (savedSearchRows ?? []).map((row) => savedSearchRowSchema.parse(row));

  const alerts = ((alertRows ?? []) as unknown as AlertRow[]).map((row) => ({
    ...alertRowSchema.parse(row),
    savedSearchName: row.saved_searches?.name ?? null,
    listingTitle: row.listings?.title ?? null,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Alertes</h1>
      <CreateAlertForm savedSearches={savedSearches} />
      {alerts.length === 0 ? (
        <EmptyState
          title="Aucune alerte pour l'instant"
          description="Créez une alerte de prix ou de verdict : DealRadar surveille le marché à votre place et vous prévient au bon moment."
        />
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}
