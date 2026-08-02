import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runIntelligencePipeline,
  resolveCategoryProfile,
  type AnalysisProcessPayload,
  type AnalysisResult,
  type CostInputs,
  type NormalizedComparable,
  type NormalizedListing,
} from "@dealradar/core";
import {
  extractProduct,
  PROMPT_VERSION,
  EXTRACTION_SCHEMA_VERSION,
  DETERMINISTIC_EXTRACTOR_VERSION,
  TCG_CARD_PROMPT_VERSION,
  TCG_CARD_EXTRACTION_SCHEMA_VERSION,
  type ExtractionImage,
  type ExtractionInput,
} from "@dealradar/ai";
import {
  createSupabaseExtractionCache,
  createSupabaseBudgetGuard,
  mapSoldRowToComparable,
  type SoldListingRow,
} from "@dealradar/ingestion";
import { logger } from "../logger";
import { buildAiExtractionConfigFromEnv } from "../ingestion/ai-provider-config";
import { buildTcgPipelineConnectorsFromEnv } from "../ingestion/tcg-connector-config";
import { processTcgCardAnalysis } from "./process-tcg-card-analysis";
import type { TcgCardProvidedHints } from "@dealradar/core";

/**
 * Job `analysis.process` (ADR 0010) — traite une requête soumise via
 * POST /v1/analyses. N'appelle jamais `extractListing()`/`analyzeListing()`
 * (`packages/ingestion`) : ces deux fonctions sont façonnées autour d'un
 * `listingId` déjà présent dans `public.listings`, ce qu'une capture mobile
 * n'est pas (voir ADR 0010, section « Précision »). Appelle directement les
 * primitives pures qu'elles utilisent en interne — `extractProduct()`
 * (`@dealradar/ai`) et `runIntelligencePipeline()` (`@dealradar/core`) —
 * sans dupliquer ni l'extraction, ni le scoring.
 */

/** Mêmes hypothèses de coût par défaut que `ingest-and-analyze.ts` (ADR 0008) — non exportées de là, dupliquées ici intentionnellement (4 constantes, pas de logique). */
const DEFAULT_COST_ASSUMPTIONS: Omit<CostInputs, "purchasePriceCents"> = {
  shippingCostCents: 0,
  platformFeeRate: 0.12,
  refurbCostCents: 0,
  riskReserveRate: 0.05,
};

const DEFAULT_CANDIDATE_POOL_LIMIT = 200;

interface AnalysisRequestRow {
  id: string;
  title: string | null;
  description: string | null;
  category_slug: string | null;
  purchase_price: number | null;
  currency: string;
  image_references: { url: string }[] | null;
  source_type: string;
  provided_tcg_hints: TcgCardProvidedHints | null;
}

interface RawSoldListingWithSource extends SoldListingRow {
  sources: { slug: string }[] | { slug: string } | null;
}

function extractSourceSlug(sources: { slug: string }[] | { slug: string } | null): string {
  if (!sources) return "unknown";
  return Array.isArray(sources) ? (sources[0]?.slug ?? "unknown") : sources.slug;
}

/**
 * Même renforcement du pré-filtrage DB que `analyze-listing.ts`
 * (catégorie + correspondance exacte sur les champs d'identité requis par
 * le profil) — `buildIdentityFilter` n'y est pas exportée, cette version
 * locale est reconstruite à partir des mêmes primitives exportées
 * (`resolveCategoryProfile`), pas une réimplémentation de la logique de
 * profil elle-même.
 */
function buildIdentityFilter(
  categorySlug: string,
  attributes: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const filter: Record<string, string | number | boolean> = { categorySlug };
  const profile = resolveCategoryProfile(categorySlug);
  if (profile) {
    for (const key of profile.requiredAttributeKeys) {
      const value = attributes[key];
      if (value !== undefined) filter[key] = value;
    }
  }
  return filter;
}

async function writeResult(
  db: SupabaseClient,
  analysisRequestId: string,
  status: "completed" | "insufficient_data" | "failed",
  result: AnalysisResult | null,
): Promise<void> {
  const { error } = await db
    .from("analysis_requests")
    .update({ status, result, updated_at: new Date().toISOString() })
    .eq("id", analysisRequestId);
  if (error) throw new Error(`Écriture du résultat d'analyse impossible : ${error.message}`);
}

function emptyResult(warnings: string[], reasons: string[]): AnalysisResult {
  return {
    product: { name: null, category: null, modelOrReference: null },
    conditionEstimated: null,
    priceDetected: null,
    marketValueEstimate: null,
    resaleRangeConservative: null,
    grossMargin: null,
    estimatedFees: null,
    netMargin: null,
    confidenceScore: 0,
    liquidityScore: 0,
    dealScore: null,
    decision: "INSUFFICIENT_DATA",
    warnings,
    reasons,
    dataAvailability: { soldTransactions: false, marketGuide: false },
  };
}

export async function processAnalysis(
  { analysisRequestId }: AnalysisProcessPayload,
  db: SupabaseClient,
): Promise<void> {
  const { data: row } = await db
    .from("analysis_requests")
    .select("id,title,description,category_slug,purchase_price,currency,image_references,source_type,provided_tcg_hints")
    .eq("id", analysisRequestId)
    .maybeSingle();
  const request = row as AnalysisRequestRow | null;
  if (!request) {
    logger.warn({ analysisRequestId }, "Requête d'analyse introuvable, traitement ignoré");
    return;
  }

  // Branche dédiée (LOT 8, mobile) — identification de carte + prix
  // traçables, jamais une décision BUY/REVIEW/PASS ni un prix d'achat
  // requis : ne partage donc aucune des étapes ci-dessous (Intelligence
  // Core). Réutilise `orchestratePokemonPipeline()` tel quel (ADR 0012).
  if (request.category_slug === "pokemon_tcg") {
    const aiConfig = buildAiExtractionConfigFromEnv();
    const cache = aiConfig
      ? createSupabaseExtractionCache(db, {
          provider: aiConfig.provider.name,
          model: aiConfig.provider.model,
          promptVersion: TCG_CARD_PROMPT_VERSION,
          schemaVersion: TCG_CARD_EXTRACTION_SCHEMA_VERSION,
          deterministicVersion: 0,
        })
      : undefined;

    const { status, result } = await processTcgCardAnalysis(
      db,
      {
        id: request.id,
        imageReferences: request.image_references ?? [],
        providedTcgHints: request.provided_tcg_hints,
      },
      {
        extractionOptions: aiConfig
          ? {
              provider: aiConfig.provider,
              cache,
              budgetGuard: createSupabaseBudgetGuard(db, {
                provider: aiConfig.provider.name,
                model: aiConfig.provider.model,
                dailyBudgetUsd: aiConfig.dailyBudgetUsd ?? 0,
                listingId: null,
              }),
            }
          : undefined,
        connectors: buildTcgPipelineConnectorsFromEnv(),
      },
    );

    await db.from("analysis_requests").update({ status, result, updated_at: new Date().toISOString() }).eq("id", analysisRequestId);
    return;
  }

  // Intelligence Core (ADR 0007) ne couvre que 5 catégories déclaratives —
  // sans elle, aucun profil d'exigence à appliquer. Jamais deviné.
  if (!request.category_slug) {
    await writeResult(
      db,
      analysisRequestId,
      "insufficient_data",
      emptyResult(["CATEGORY_REQUIRED"], ["Catégorie non confirmée par l'utilisateur."]),
    );
    return;
  }

  const images: ExtractionImage[] = (request.image_references ?? []).map((ref, position) => ({
    url: ref.url,
    position,
  }));

  const aiConfig = buildAiExtractionConfigFromEnv();
  const cache = aiConfig
    ? createSupabaseExtractionCache(db, {
        provider: aiConfig.provider.name,
        model: aiConfig.provider.model,
        promptVersion: PROMPT_VERSION,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        deterministicVersion: DETERMINISTIC_EXTRACTOR_VERSION,
      })
    : undefined;

  const extractionInput: ExtractionInput = {
    title: request.title ?? "",
    description: request.description,
    categorySlug: request.category_slug,
    images,
  };

  const extraction = await extractProduct(extractionInput, {
    provider: aiConfig?.provider,
    cache,
    budgetGuard: aiConfig
      ? createSupabaseBudgetGuard(db, {
          provider: aiConfig.provider.name,
          model: aiConfig.provider.model,
          dailyBudgetUsd: aiConfig.dailyBudgetUsd ?? 0,
          listingId: null,
        })
      : undefined,
    maxImages: aiConfig?.maxImages,
    imageDomainAllowlist: aiConfig?.imageDomainAllowlist,
  });

  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(extraction.product.attributes)) {
    if (entry) attributes[key] = entry.value;
  }

  const productName = [extraction.product.brand?.value, extraction.product.model?.value]
    .filter((v): v is string => Boolean(v))
    .join(" ") || request.title;

  const baseWarnings = extraction.warnings.map((w) => w.code as string);

  // Sans état estimé, aucune identité fiable pour Intelligence Core (même
  // exigence que mapListingToIntelligence côté ingestion) — jamais deviné.
  const condition = extraction.product.condition?.value ?? null;
  if (!condition) {
    await writeResult(
      db,
      analysisRequestId,
      "insufficient_data",
      {
        ...emptyResult([...baseWarnings, "CONDITION_UNKNOWN"], ["État de l'article non détecté."]),
        product: {
          name: productName,
          category: request.category_slug,
          modelOrReference: extraction.product.model?.value ?? extraction.product.reference?.value ?? null,
        },
      },
    );
    return;
  }

  // Sans prix d'achat confirmé, le calcul de marge serait inventé — jamais
  // un prix d'achat par défaut (section 12 du brief produit).
  if (request.purchase_price === null) {
    await writeResult(
      db,
      analysisRequestId,
      "insufficient_data",
      {
        ...emptyResult([...baseWarnings, "PURCHASE_PRICE_REQUIRED"], ["Prix d'achat non confirmé par l'utilisateur."]),
        product: {
          name: productName,
          category: request.category_slug,
          modelOrReference: extraction.product.model?.value ?? extraction.product.reference?.value ?? null,
        },
        conditionEstimated: condition,
      },
    );
    return;
  }

  const listing: NormalizedListing = {
    id: analysisRequestId,
    sourceSlug: request.source_type,
    // Purement descriptif (jamais utilisé pour l'identification) — un
    // repli est donc sûr si ni l'extraction ni la requête n'ont de titre.
    title: productName ?? "Analyse mobile",
    priceCents: Math.round(request.purchase_price * 100),
    currency: request.currency,
    condition,
    categorySlug: request.category_slug,
    attributes,
  };

  const identityFilter = buildIdentityFilter(listing.categorySlug, listing.attributes);
  const { data: candidateRows } = await db
    .from("listings")
    .select("id,title,price_cents,currency,condition,attributes,sold_at,sources(slug)")
    .eq("status", "sold")
    .eq("currency", listing.currency)
    .eq("condition", listing.condition)
    .contains("attributes", identityFilter)
    .limit(DEFAULT_CANDIDATE_POOL_LIMIT);

  const candidates = ((candidateRows ?? []) as RawSoldListingWithSource[])
    .map((r) => mapSoldRowToComparable(r, extractSourceSlug(r.sources), listing.categorySlug))
    .filter((c): c is NormalizedComparable => c !== null);

  const pipelineResult = runIntelligencePipeline({
    listing,
    candidates,
    costs: { purchasePriceCents: listing.priceCents, ...DEFAULT_COST_ASSUMPTIONS },
    asOf: new Date().toISOString(),
  });

  const usedSold = pipelineResult.comparables.used.length > 0;

  const analysisResult: AnalysisResult = {
    product: {
      name: productName,
      category: listing.categorySlug,
      modelOrReference: extraction.product.model?.value ?? extraction.product.reference?.value ?? null,
    },
    conditionEstimated: condition,
    priceDetected: { amount: request.purchase_price, currency: listing.currency },
    marketValueEstimate: pipelineResult.estimate
      ? {
          amount: pipelineResult.estimate.conservativeCents / 100,
          currency: listing.currency,
          provenance: usedSold ? "sold_transaction" : "unknown",
        }
      : null,
    resaleRangeConservative: pipelineResult.estimate
      ? {
          low: pipelineResult.estimate.p25Cents / 100,
          high: pipelineResult.estimate.p75Cents / 100,
          currency: listing.currency,
        }
      : null,
    grossMargin: pipelineResult.netProfit
      ? (pipelineResult.netProfit.resaleBasisCents - listing.priceCents) / 100
      : null,
    estimatedFees: pipelineResult.netProfit
      ? (pipelineResult.netProfit.platformFeeCents + pipelineResult.netProfit.riskReserveCents) / 100
      : null,
    netMargin: pipelineResult.netProfit ? pipelineResult.netProfit.netProfitCents / 100 : null,
    confidenceScore: pipelineResult.scores.confidence,
    liquidityScore: pipelineResult.scores.liquidity,
    dealScore: pipelineResult.scores.deal,
    decision: pipelineResult.decision,
    warnings: baseWarnings,
    reasons: pipelineResult.whyPanel.factors.map((f) => f.detail),
    dataAvailability: { soldTransactions: usedSold, marketGuide: false },
  };

  await writeResult(
    db,
    analysisRequestId,
    pipelineResult.decision === "INSUFFICIENT_DATA" ? "insufficient_data" : "completed",
    analysisResult,
  );
}
