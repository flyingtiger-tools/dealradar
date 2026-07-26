"use server";

import { QUEUES, ingestSourcePayload } from "@dealradar/core";
import { createClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/pgboss";

export type TriggerIngestionResult = { ok: true } | { ok: false; error: string };

/**
 * Empile un job `ingest.source` — ne fait jamais l'ingestion elle-même (voir
 * ADR 0008 : écritures marché uniquement via workers). Revérifie le rôle
 * admin côté serveur, ne fait jamais confiance au client.
 */
export async function triggerIngestion(input: { categorySlug: string; q: string }): Promise<TriggerIngestionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Non authentifié." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return { ok: false, error: "Réservé aux administrateurs." };

  const parsed = ingestSourcePayload.safeParse({ sourceSlug: "ebay", categorySlug: input.categorySlug, q: input.q });
  if (!parsed.success) return { ok: false, error: "Requête invalide (catégorie et texte de recherche requis)." };

  try {
    await enqueueJob(QUEUES.ingestSource, parsed.data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erreur inconnue lors de l'envoi du job." };
  }
}
