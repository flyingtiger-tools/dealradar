import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketObservation } from "@dealradar/connectors";

/**
 * Persiste des `MarketObservation` (LOT "Multi-Source Market Intelligence
 * Foundation") dans `market_observations` (migration 0018) — idempotent :
 * la même observation (même source+item+horodatage, la clé d'unicité de la
 * table) écrite deux fois fusionne en place, jamais un doublon. Une
 * observation avec un NOUVEL horodatage crée une nouvelle ligne — l'
 * historique est préservé, jamais écrasé (même principe que
 * `persistTcgPriceObservation`, qui reste inchangé et non touché ici).
 *
 * Ne lève jamais sur une observation individuelle invalide : la rejette
 * (résultat `"refused"`) et continue les autres — une source qui produit
 * une observation malformée ne doit jamais bloquer la persistance des
 * autres.
 */

export type PersistMarketObservationOutcome = "inserted" | "unchanged" | "refused";

export interface PersistMarketObservationResult {
  outcome: PersistMarketObservationOutcome;
  source: string;
  sourceItemId: string;
  reason?: string;
}

const ON_CONFLICT_COLUMNS = "source,source_item_id,observed_at";

function isValidObservation(observation: MarketObservation): string | null {
  if (!observation.source) return "source manquante";
  if (!observation.sourceItemId) return "sourceItemId manquant";
  if (!observation.observedAt) return "observedAt manquant";
  if (!observation.title) return "title manquant";
  if (observation.priceAmountCents < 0) return "priceAmountCents négatif";
  if (!observation.currency) return "currency manquante";
  return null;
}

function toRow(observation: MarketObservation): Record<string, unknown> {
  return {
    source: observation.source,
    source_item_id: observation.sourceItemId,
    source_url: observation.sourceUrl,
    observed_at: observation.observedAt,
    product_key: observation.productKey,
    category_slug: "", // renseigné par l'appelant via `persistMarketObservations(categorySlug, ...)`, jamais deviné ici
    query: observation.query,
    title: observation.title,
    brand: observation.brand,
    model: observation.model,
    variant: observation.variant,
    identifiers: observation.identifiers,
    condition: observation.condition,
    completeness: observation.completeness,
    price_cents: observation.priceAmountCents,
    currency: observation.currency,
    shipping_cost_cents: observation.shippingCostCents,
    total_price_cents: observation.totalPriceCents,
    country: observation.country,
    marketplace: observation.marketplace,
    evidence_type: observation.evidenceType,
    evidence_tier: observation.evidenceTier,
    sold_at: observation.soldAt,
    match_score: observation.matchScore,
    raw_metadata: observation.rawMetadataRef,
    ingestion_version: observation.ingestionVersion,
  };
}

async function persistOne(supabase: SupabaseClient, categorySlug: string, observation: MarketObservation): Promise<PersistMarketObservationResult> {
  const invalidReason = isValidObservation(observation);
  if (invalidReason) {
    return { outcome: "refused", source: observation.source, sourceItemId: observation.sourceItemId, reason: invalidReason };
  }

  const row = { ...toRow(observation), category_slug: categorySlug };

  const { data: existing } = await supabase
    .from("market_observations")
    .select("id")
    .eq("source", observation.source)
    .eq("source_item_id", observation.sourceItemId)
    .eq("observed_at", observation.observedAt)
    .maybeSingle();

  const { error } = await supabase.from("market_observations").upsert(row, { onConflict: ON_CONFLICT_COLUMNS });
  if (error) {
    return {
      outcome: "refused",
      source: observation.source,
      sourceItemId: observation.sourceItemId,
      reason: (error as { message?: string }).message ?? "erreur de persistance inconnue",
    };
  }

  return { outcome: existing ? "unchanged" : "inserted", source: observation.source, sourceItemId: observation.sourceItemId };
}

/** Une entrée du résultat par observation en entrée, dans le même ordre — jamais fusionnées entre elles. */
export async function persistMarketObservations(
  supabase: SupabaseClient,
  categorySlug: string,
  observations: readonly MarketObservation[],
): Promise<PersistMarketObservationResult[]> {
  const results: PersistMarketObservationResult[] = [];
  for (const observation of observations) {
    results.push(await persistOne(supabase, categorySlug, observation));
  }
  return results;
}
