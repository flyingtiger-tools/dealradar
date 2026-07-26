import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractProduct,
  PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  DETERMINISTIC_EXTRACTOR_VERSION,
  type AIProvider,
  type BudgetGuard,
  type ExtractionSource,
  type ExtractionWarning,
} from "@dealradar/ai";
import { splitAttributes } from "./map-to-intelligence";
import { createSupabaseExtractionCache } from "./ai-cache-supabase";
import { createSupabaseBudgetGuard } from "./ai-budget-supabase";

export interface ExtractListingInput {
  supabase: SupabaseClient;
  listingId: string;
  /** `undefined` = pas de clé IA configurée — dégradation gracieuse vers le déterministe seul. */
  provider?: AIProvider;
  aiDailyBudgetUsd?: number;
  maxImages?: number;
  imageDomainAllowlist?: string[];
}

export interface ExtractListingOutcome {
  /** false = annonce introuvable ou sans catégorie connue — aucune extraction possible. */
  extracted: boolean;
  source: ExtractionSource | null;
  warnings: ExtractionWarning[];
}

interface ListingForExtraction {
  id: string;
  title: string;
  description: string | null;
  condition: string | null;
  attributes: Record<string, unknown>;
}

interface ListingMediaRow {
  source_url: string;
  position: number;
  content_hash: string | null;
}

/**
 * Enrichit une annonce déjà persistée avec l'extraction IA (Lot 5) : charge
 * l'annonce et ses images, appelle `extractProduct()`, fusionne le résultat
 * dans `attributes`/`condition`. `analyze-listing.ts` (Lot 3/4) n'est jamais
 * modifié — cette étape alimente juste des données mieux renseignées en amont.
 */
export async function extractListing(input: ExtractListingInput): Promise<ExtractListingOutcome> {
  const { supabase, listingId } = input;

  const { data: row } = await supabase
    .from("listings")
    .select("id,title,description,condition,attributes")
    .eq("id", listingId)
    .maybeSingle();
  const listingRow = row as ListingForExtraction | null;
  if (!listingRow) throw new Error(`Annonce introuvable : ${listingId}.`);

  const { categorySlug, attributes: existingAttributes } = splitAttributes(listingRow.attributes ?? {});
  if (!categorySlug) {
    return { extracted: false, source: null, warnings: [] };
  }

  const { data: mediaRows } = await supabase
    .from("listing_media")
    .select("source_url,position,content_hash")
    .eq("listing_id", listingId)
    .order("position");
  const images = ((mediaRows ?? []) as ListingMediaRow[]).map((media) => ({
    url: media.source_url,
    position: media.position,
  }));

  const cache = input.provider
    ? createSupabaseExtractionCache(supabase, {
        provider: input.provider.name,
        model: input.provider.model,
        promptVersion: PROMPT_VERSION,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        deterministicVersion: DETERMINISTIC_EXTRACTOR_VERSION,
      })
    : undefined;

  const budgetGuard: BudgetGuard | undefined =
    input.provider && input.aiDailyBudgetUsd !== undefined
      ? createSupabaseBudgetGuard(supabase, {
          provider: input.provider.name,
          model: input.provider.model,
          dailyBudgetUsd: input.aiDailyBudgetUsd,
          listingId,
        })
      : undefined;

  const result = await extractProduct(
    {
      title: listingRow.title,
      description: listingRow.description,
      categorySlug,
      images,
      providedAttributes: existingAttributes,
    },
    {
      provider: input.provider,
      cache,
      budgetGuard,
      maxImages: input.maxImages,
      imageDomainAllowlist: input.imageDomainAllowlist,
    },
  );

  const mergedAttributes: Record<string, string | number | boolean> = { ...existingAttributes, categorySlug };
  for (const [key, entry] of Object.entries(result.product.attributes)) {
    if (entry) mergedAttributes[key] = entry.value;
  }

  const updates: Record<string, unknown> = { attributes: mergedAttributes, processing_status: "normalized" };
  if (!listingRow.condition && result.product.condition) {
    updates.condition = result.product.condition.value;
  }

  await supabase.from("listings").update(updates).eq("id", listingId);

  return { extracted: true, source: result.source, warnings: result.warnings };
}
