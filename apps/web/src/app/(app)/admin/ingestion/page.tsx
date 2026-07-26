import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPrice, formatDate } from "@/lib/format";
import { TriggerIngestionForm } from "./trigger-ingestion-form";

export const metadata: Metadata = { title: "Ingestion — Administration" };

const STATUS_LABELS: Record<string, string> = {
  collected: "COLLECTED",
  normalized: "NORMALIZED",
  analyzed: "ANALYZED",
  insufficient_data: "INSUFFICIENT_DATA",
  failed: "FAILED",
};

interface IngestionRunRow {
  id: string;
  category_slug: string;
  query_text: string;
  status: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  started_at: string;
  finished_at: string | null;
}

interface ListingRow {
  id: string;
  title: string;
  url: string;
  price_cents: number;
  currency: string;
  processing_status: string;
  last_seen_at: string;
}

interface IngestionErrorRow {
  id: number;
  ingestion_run_id: string;
  external_id: string | null;
  http_status: number | null;
  message: string;
  occurred_at: string;
}

/** Réservé au rôle admin — même garde que /admin. Interface de test du Lot 4, aucune fonctionnalité utilisateur. */
export default async function AdminIngestionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const { data: ebaySource } = await supabase.from("sources").select("id").eq("slug", "ebay").maybeSingle();
  const ebaySourceId = (ebaySource as { id: string } | null)?.id;

  const [{ data: runs }, { data: listings }, { data: errors }] = await Promise.all([
    supabase
      .from("ingestion_runs")
      .select("id,category_slug,query_text,status,fetched,inserted,updated,skipped,failed,started_at,finished_at")
      .order("started_at", { ascending: false })
      .limit(20),
    ebaySourceId
      ? supabase
          .from("listings")
          .select("id,title,url,price_cents,currency,processing_status,last_seen_at")
          .eq("source_id", ebaySourceId)
          .order("last_seen_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] as ListingRow[] }),
    supabase
      .from("ingestion_errors")
      .select("id,ingestion_run_id,external_id,http_status,message,occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(20),
  ]);

  const runRows = (runs ?? []) as IngestionRunRow[];
  const listingRows = (listings ?? []) as ListingRow[];
  const errorRows = (errors ?? []) as IngestionErrorRow[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ingestion — eBay</h1>
        <Link href="/admin" className="text-sm text-muted underline underline-offset-4">
          ← Administration
        </Link>
      </div>

      <TriggerIngestionForm />

      <Card>
        <CardHeader>
          <CardTitle>Runs récents</CardTitle>
        </CardHeader>
        <CardBody className="p-0 pt-3">
          {runRows.length === 0 ? (
            <EmptyState title="Aucun run" description="Lance une ingestion ci-dessus pour voir apparaître son suivi ici." />
          ) : (
            <ul className="divide-y divide-line">
              {runRows.map((run) => (
                <li key={run.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {run.category_slug} · « {run.query_text} »
                    </p>
                    <p className="font-data text-xs text-muted tabular-nums">
                      {run.status} · récupérées {run.fetched} · insérées {run.inserted} · mises à jour {run.updated} ·
                      ignorées {run.skipped} · échecs {run.failed} · {formatDate(run.started_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Annonces eBay</CardTitle>
        </CardHeader>
        <CardBody className="p-0 pt-3">
          {listingRows.length === 0 ? (
            <EmptyState
              title="Aucune annonce collectée"
              description="Le marché est vide tant qu'aucune ingestion n'a réussi à joindre l'API eBay."
            />
          ) : (
            <ul className="divide-y divide-line">
              {listingRows.map((listing) => (
                <li key={listing.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{listing.title}</p>
                    <p className="font-data text-xs text-muted tabular-nums">
                      {formatPrice(listing.price_cents, listing.currency)} · {STATUS_LABELS[listing.processing_status] ?? listing.processing_status} ·
                      vu {formatDate(listing.last_seen_at)}
                    </p>
                  </div>
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-muted underline underline-offset-4"
                  >
                    Voir sur eBay
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Erreurs de connecteur</CardTitle>
        </CardHeader>
        <CardBody className="p-0 pt-3">
          {errorRows.length === 0 ? (
            <EmptyState title="Aucune erreur" description="Les erreurs de connecteur apparaîtront ici, journalisées par run." />
          ) : (
            <ul className="divide-y divide-line">
              {errorRows.map((err) => (
                <li key={err.id} className="px-4 py-3">
                  <p className="text-sm text-down">
                    {err.http_status ? `HTTP ${err.http_status} — ` : ""}
                    {err.message}
                  </p>
                  <p className="font-data text-xs text-muted tabular-nums">
                    {err.external_id ? `annonce ${err.external_id} · ` : ""}
                    {formatDate(err.occurred_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
