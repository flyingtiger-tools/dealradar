import { dealScoreV1, type ComparableSet } from "@dealradar/core";
import { createServiceClient } from "../db";
import { logger } from "../logger";
import type { ListingPayload } from "../queues";

/**
 * Job : recalculer le Deal Score d'une annonce.
 * Le comparable_set est lu tel quel (matérialisé par le job normalize/comparables
 * au Lot 3) : ce handler reste une composition pure lecture → moteur → écriture.
 */
export async function scoreListing({ listingId }: ListingPayload): Promise<void> {
  const db = createServiceClient();

  const { data: listing, error: listingError } = await db
    .from("listings")
    .select("id, price_cents, condition, first_seen_at")
    .eq("id", listingId)
    .single();
  if (listingError || !listing) {
    logger.warn({ listingId }, "Annonce introuvable, scoring ignoré");
    return;
  }

  const { data: setRow } = await db
    .from("comparable_sets")
    .select("id, method, computed_at, comparable_members(listing_id, similarity, price_cents)")
    .eq("listing_id", listingId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const comparables: ComparableSet = {
    id: setRow?.id ?? "none",
    listingId,
    method: setRow?.method ?? "none",
    computedAt: setRow?.computed_at ?? new Date().toISOString(),
    members: (setRow?.comparable_members ?? []).map((m) => ({
      listingId: m.listing_id,
      similarity: m.similarity,
      priceCents: m.price_cents,
    })),
  };

  const result = dealScoreV1.compute({
    listing: {
      id: listing.id,
      priceCents: listing.price_cents,
      condition: listing.condition,
      firstSeenAt: listing.first_seen_at,
    },
    comparables,
  });

  const { error: insertError } = await db.from("scores").insert({
    listing_id: listingId,
    score_type: "deal",
    value: result.value,
    verdict: result.verdict,
    engine_version: dealScoreV1.version,
    comparable_set_id: setRow?.id ?? null,
    explanation: result.explanation,
  });
  if (insertError) throw new Error(`Écriture du score impossible : ${insertError.message}`);

  logger.info({ listingId, value: result.value, verdict: result.verdict }, "Score calculé");
}
