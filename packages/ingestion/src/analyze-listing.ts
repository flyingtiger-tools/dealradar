import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runIntelligencePipeline,
  resolveCategoryProfile,
  type CostInputs,
  type IntelligencePipelineResult,
  type NormalizedComparable,
  type NormalizedListing as PipelineListing,
} from "@dealradar/core";
import { mapListingToIntelligence, mapSoldRowToComparable, type ListingRow, type SoldListingRow } from "./map-to-intelligence";

export interface AnalyzeListingInput {
  supabase: SupabaseClient;
  listingId: string;
  costs: CostInputs;
  asOf: string;
  candidatePoolLimit?: number;
}

export interface AnalyzeListingOutcome {
  /** false = la donnée était trop pauvre pour même construire une entrée valide (catégorie/condition inconnues). */
  analyzed: boolean;
  result: IntelligencePipelineResult | null;
}

const DEFAULT_CANDIDATE_POOL_LIMIT = 200;

interface RawListingWithSource extends ListingRow {
  sources: { slug: string }[] | { slug: string } | null;
}

interface RawSoldListingWithSource extends SoldListingRow {
  sources: { slug: string }[] | { slug: string } | null;
}

function extractSourceSlug(sources: { slug: string }[] | { slug: string } | null): string {
  if (!sources) return "unknown";
  return Array.isArray(sources) ? (sources[0]?.slug ?? "unknown") : sources.slug;
}

/**
 * Renforcement du pré-filtrage DB (jamais la seule catégorie) : catégorie +
 * devise + condition + correspondance exacte sur les champs d'identité
 * requis par le profil (ex. setNumber pour LEGO). Le plus proche équivalent
 * DB d'un seuil de similarité, cohérent avec la limite déjà documentée du
 * Lot 3 (correspondance exacte, pas de matching flou en V1).
 */
function buildIdentityFilter(listing: PipelineListing): Record<string, string | number | boolean> {
  const filter: Record<string, string | number | boolean> = { categorySlug: listing.categorySlug };
  const profile = resolveCategoryProfile(listing.categorySlug);
  if (profile) {
    for (const key of profile.requiredAttributeKeys) {
      const value = listing.attributes[key];
      if (value !== undefined) filter[key] = value;
    }
  }
  return filter;
}

/**
 * Charge une annonce persistée, rassemble un pool de comparables vendus
 * suffisamment strict, appelle Intelligence Core, et persiste le résultat.
 * Ne renforce ni n'affaiblit les règles du Lot 3 : le pipeline lui-même
 * décide de renvoyer INSUFFICIENT_DATA quand les comparables manquent.
 */
export async function analyzeListing(input: AnalyzeListingInput): Promise<AnalyzeListingOutcome> {
  const { supabase, listingId, costs, asOf } = input;
  const candidatePoolLimit = input.candidatePoolLimit ?? DEFAULT_CANDIDATE_POOL_LIMIT;

  const { data: row } = await supabase
    .from("listings")
    .select("id,title,price_cents,currency,condition,attributes,first_seen_at,sources(slug)")
    .eq("id", listingId)
    .maybeSingle();
  const listingRow = row as RawListingWithSource | null;
  if (!listingRow) throw new Error(`Annonce introuvable : ${listingId}.`);

  const sourceSlug = extractSourceSlug(listingRow.sources);
  const listing = mapListingToIntelligence(listingRow, sourceSlug);

  if (!listing) {
    await supabase.from("listings").update({ processing_status: "insufficient_data" }).eq("id", listingId);
    return { analyzed: false, result: null };
  }

  const identityFilter = buildIdentityFilter(listing);
  const { data: candidateRows } = await supabase
    .from("listings")
    .select("id,title,price_cents,currency,condition,attributes,sold_at,sources(slug)")
    .eq("status", "sold")
    .eq("currency", listing.currency)
    .eq("condition", listing.condition)
    .neq("id", listingId)
    .contains("attributes", identityFilter)
    .limit(candidatePoolLimit);

  const candidates = ((candidateRows ?? []) as RawSoldListingWithSource[])
    .map((r) => mapSoldRowToComparable(r, extractSourceSlug(r.sources), listing.categorySlug))
    .filter((c): c is NormalizedComparable => c !== null);

  const result = runIntelligencePipeline({ listing, candidates, costs, asOf });

  await supabase.from("intelligence_results").insert({
    listing_id: listingId,
    decision: result.decision,
    deal_score: result.scores.deal,
    confidence_score: result.scores.confidence,
    liquidity_score: result.scores.liquidity,
    why_panel: result.whyPanel,
  });

  await supabase
    .from("listings")
    .update({ processing_status: result.decision === "INSUFFICIENT_DATA" ? "insufficient_data" : "analyzed" })
    .eq("id", listingId);

  return { analyzed: true, result };
}
