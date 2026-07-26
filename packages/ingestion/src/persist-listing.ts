import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidatedNormalizedListing } from "./schemas";

export type PersistOutcome = "inserted" | "updated" | "skipped";

export interface PersistResult {
  listingId: string;
  outcome: PersistOutcome;
}

/**
 * Upsert idempotent sur (source_id, external_id) — la contrainte unique
 * existe déjà sur `listings` (migration 0004). Un rerun avec les mêmes
 * données ne crée jamais de doublon ; l'historique de prix
 * (`price_observations`) n'est alimenté que si le prix a réellement changé.
 */
export async function persistListing(
  supabase: SupabaseClient,
  sourceId: string,
  listing: ValidatedNormalizedListing,
): Promise<PersistResult> {
  const { data: existing } = await supabase
    .from("listings")
    .select("id, price_cents, status")
    .eq("source_id", sourceId)
    .eq("external_id", listing.meta.externalId)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  const row = {
    source_id: sourceId,
    external_id: listing.meta.externalId,
    url: listing.meta.originalUrl,
    title: listing.title,
    description: listing.description ?? null,
    price_cents: listing.price.amountCents,
    currency: listing.price.currency,
    condition: listing.condition,
    // `categories` (taxonomie générale du marché) est une table distincte,
    // non peuplée dans ce lot — le slug de profil Intelligence Core
    // (lego/pokemon_tcg/apple/gaming/photo) est stocké dans attributes,
    // à côté des aspects bruts de la source. Voir map-to-intelligence.ts
    // pour la lecture inverse. Limite documentée dans l'ADR 0008.
    category_id: null,
    attributes: { ...listing.attributes, categorySlug: listing.categorySlug },
    seller_external_id: listing.seller.externalId,
    location_text: listing.location.text,
    raw_payload: listing.meta.rawPayloadRef ?? null,
    raw_payload_collected_at: listing.meta.collectedAt,
    processing_status: "normalized",
    last_seen_at: nowIso,
  };

  const existingRow = existing as { id: string; price_cents: number; status: string } | null;

  if (!existingRow) {
    const { data: inserted, error } = await supabase
      .from("listings")
      .insert({ ...row, status: "active", first_seen_at: nowIso })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(`Insertion de l'annonce impossible : ${(error as { message?: string } | null)?.message ?? "erreur inconnue"}`);
    }
    const insertedRow = inserted as { id: string };
    await insertPriceObservation(supabase, insertedRow.id, listing.price.amountCents, listing.price.currency, "active");
    return { listingId: insertedRow.id, outcome: "inserted" };
  }

  const priceChanged = existingRow.price_cents !== listing.price.amountCents;

  const { error: updateError } = await supabase.from("listings").update(row).eq("id", existingRow.id);
  if (updateError) {
    throw new Error(`Mise à jour de l'annonce impossible : ${(updateError as { message?: string }).message ?? "erreur inconnue"}`);
  }

  if (priceChanged) {
    await insertPriceObservation(
      supabase,
      existingRow.id,
      listing.price.amountCents,
      listing.price.currency,
      existingRow.status,
    );
  }

  return { listingId: existingRow.id, outcome: priceChanged ? "updated" : "skipped" };
}

async function insertPriceObservation(
  supabase: SupabaseClient,
  listingId: string,
  priceCents: number,
  currency: string,
  status: string,
): Promise<void> {
  const { error } = await supabase
    .from("price_observations")
    .insert({ listing_id: listingId, price_cents: priceCents, currency, status });
  if (error) {
    throw new Error(`Historique de prix impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }
}
