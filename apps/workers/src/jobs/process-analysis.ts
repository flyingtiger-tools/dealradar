import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runIntelligencePipeline,
  resolveCategoryProfile,
  buildSearchQueries,
  computeNetProfit,
  computeDealScore,
  decideFromFusedValuation,
  type AnalysisProcessPayload,
  type AnalysisResult,
  type CostInputs,
  type NormalizedComparable,
  type NormalizedListing,
  type FusedValuation,
  type EvidenceQualityTier,
} from "@dealradar/core";
import { resolveSourcesForCategory, createFrankfurterProvider, createCachedFxRateProvider } from "@dealradar/connectors";
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
  gatherActiveListingEvidence,
  signStorageImageUrl,
  orchestrateMarketIntelligence,
  type SoldListingRow,
} from "@dealradar/ingestion";
import { logger } from "../logger";
import { buildAiExtractionConfigFromEnv } from "../ingestion/ai-provider-config";
import { buildTcgPipelineConnectorsFromEnv } from "../ingestion/tcg-connector-config";
import { tryBuildEbayConnectorFromEnv } from "../ingestion/connector-config";
import { buildMarketSourcesFromEnv } from "../ingestion/market-source-factory";
import { processTcgCardAnalysis } from "@dealradar/ingestion";
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

/**
 * Fournisseur FX (LOT "Source Wave 3", section 1) — Frankfurter : gratuit,
 * aucune clé/authentification à poser (même choix que le MVP FX déjà en
 * place pour la verticale TCG, voir `docs/fx-provider-swap.md`), donc
 * TOUJOURS disponible sans configuration supplémentaire, contrairement à
 * chaque source de marché elle-même. Enveloppé dans un cache TTL borné
 * (15 min par défaut) au niveau MODULE — un seul processus workers sert
 * potentiellement de nombreuses analyses, le cache doit survivre entre
 * elles, jamais recréé à chaque appel de `processAnalysis`.
 */
const fxRateProvider = createCachedFxRateProvider(createFrankfurterProvider());

/**
 * Provenance affichable (`marketDataProvenanceSchema`, `@dealradar/
 * contracts`) depuis le palier de preuve le plus fort de la fusion
 * multi-source (LOT "Source Wave 2", section 7) — jamais "sold_transaction"
 * pour autre chose qu'un palier A (règle produit absolue, même principe que
 * `usedSold ? "sold_transaction" : ...` déjà en place pour le chemin
 * existant, voir plus bas).
 */
function provenanceForEvidenceTier(tier: EvidenceQualityTier | null): "sold_transaction" | "market_guide" | "active_listing" | "retail_price" | "unknown" {
  switch (tier) {
    case "A":
      return "sold_transaction";
    case "B":
      return "market_guide";
    case "C":
    case "D":
      return "active_listing";
    case "E":
      return "retail_price";
    default:
      return "unknown";
  }
}

/**
 * Score de liquidité HEURISTIQUE pour une valorisation fusionnée
 * (LOT "Source Wave 2") — analogue en esprit à `computeLiquidityScore`
 * (volume + fraîcheur, `@dealradar/core/intelligence/scores.ts`) mais
 * appliqué à une forme d'évidence différente (`FusedValuation` n'a pas de
 * liste de comparables vendus individuels) : jamais présenté comme le
 * même calcul, juste une approximation honnête documentée comme telle.
 */
function estimateLiquidityFromFusedValuation(fused: FusedValuation): number {
  if (fused.status === "insufficient") return 0;
  const volumeComponent = Math.min(fused.evidenceCount, 10) * 6;
  const recencyComponent = fused.freshnessHours === null ? 0 : Math.max(0, 40 - Math.round(fused.freshnessHours / 24));
  return Math.min(100, volumeComponent + recencyComponent);
}

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
        logger,
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

  // `image_references[].url` pointe vers le bucket PRIVÉ `analysis-uploads`
  // (`public: false`) — un provider IA (OpenAI, `image_url: { url }`)
  // télécharge l'image depuis SES propres serveurs, sans la session
  // Supabase de l'utilisateur : l'URL brute est donc invisible pour lui,
  // toute extraction échouerait silencieusement en `PROVIDER_ERROR` (bug
  // réel trouvé et corrigé ce lot — `process-tcg-card-analysis.ts` évite
  // déjà ce piège pour la verticale TCG, voir `signStorageImageUrl`). Une
  // image qui ne peut pas être signée est simplement omise, jamais
  // transmise en clair au provider (voir `sign-storage-image-url.ts`).
  const images: ExtractionImage[] = [];
  for (const [position, ref] of (request.image_references ?? []).entries()) {
    const signedUrl = await signStorageImageUrl(db, ref.url);
    if (!signedUrl) {
      logger.warn({ analysisRequestId, url: ref.url }, "Impossible de générer une URL signée pour cette image — image ignorée");
      continue;
    }
    images.push({ url: signedUrl, position });
  }

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

  const soldCandidates = ((candidateRows ?? []) as RawSoldListingWithSource[])
    .map((r) => mapSoldRowToComparable(r, extractSourceSlug(r.sources), listing.categorySlug))
    .filter((c): c is NormalizedComparable => c !== null);

  // Repli annonces actives (LOT "Universal Object Valuation Foundation") —
  // uniquement quand la base ne fournit aucune vente confirmée pour cette
  // catégorie : jamais un mélange avec des ventes déjà trouvées, jamais un
  // second appel si la base a déjà de quoi statuer. `tryBuildEbayConnectorFromEnv()`
  // rend cet enrichissement strictement optionnel — aucune clé eBay posée
  // aujourd'hui (voir docs/mobile/vision-provider-evaluation.md) donc ce
  // bloc est actuellement toujours un no-op silencieux en pratique, jamais
  // un blocage. Portée volontairement limitée : ne retente pas si la base
  // avait des lignes qui ont simplement échoué le filtrage de similarité
  // (cas plus rare, laissé pour un lot futur — voir BUILDER HANDOFF).
  const queries = buildSearchQueries({
    brand: extraction.product.brand?.value ?? null,
    model: extraction.product.model?.value ?? null,
    identifiers: [extraction.product.reference?.value ?? null],
    titleFallback: productName,
  });

  let activeCandidates: NormalizedComparable[] = [];
  if (soldCandidates.length === 0) {
    const ebayConnector = tryBuildEbayConnectorFromEnv();
    if (ebayConnector) {
      try {
        activeCandidates = await gatherActiveListingEvidence({
          connector: ebayConnector,
          categorySlug: listing.categorySlug,
          queries,
        });
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : "erreur inconnue" },
          "eBay : recherche d'annonces actives en repli a échoué, poursuite sans cette preuve",
        );
      }
    }
  }

  const pipelineResult = runIntelligencePipeline({
    listing,
    candidates: [...soldCandidates, ...activeCandidates],
    costs: { purchasePriceCents: listing.priceCents, ...DEFAULT_COST_ASSUMPTIONS },
    asOf: new Date().toISOString(),
  });

  const usedSold = pipelineResult.comparables.used.length > 0;
  const usedActiveListings = pipelineResult.estimate?.evidenceTier === "active_listing";

  // Enrichissement multi-source (LOT "Source Wave 2", section 6) —
  // UNIQUEMENT quand le chemin existant (ventes confirmées en base + repli
  // eBay ci-dessus) n'a rien trouvé d'exploitable : jamais un mélange avec
  // une estimation déjà statuée, exactement le même principe de repli déjà
  // en place pour eBay ci-dessus. Une panne de cet enrichissement (source
  // en panne, persistance indisponible) n'empêche jamais d'écrire le
  // résultat existant — voir `orchestrateMarketIntelligence`, qui isole
  // déjà la persistance, et le `try/catch` ici qui isole tout le reste.
  let marketIntelligence: Awaited<ReturnType<typeof orchestrateMarketIntelligence>> | null = null;
  if (pipelineResult.decision === "INSUFFICIENT_DATA") {
    const { sources } = buildMarketSourcesFromEnv();
    const resolvedSources = resolveSourcesForCategory(listing.categorySlug, sources);
    if (resolvedSources.length > 0) {
      const targetAttributes: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(listing.attributes)) {
        if (typeof value === "string" || typeof value === "number") targetAttributes[key] = value;
      }
      try {
        marketIntelligence = await orchestrateMarketIntelligence({
          categorySlug: listing.categorySlug,
          q: queries.exact || productName || listing.title,
          sources: resolvedSources,
          target: { currency: listing.currency, condition: listing.condition, attributes: targetAttributes },
          // Résout automatiquement un taux pour chaque devise étrangère
          // réellement observée (LOT "Source Wave 3", section 1) — Frankfurter,
          // gratuit, mis en cache au niveau module (voir plus haut). Une
          // observation sans taux disponible/fiable reste écartée, jamais
          // devinée (voir `mapMarketObservationsToFusionObservations`).
          fxRateProvider,
          persistence: { supabase: db },
        });
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : "erreur inconnue" },
          "Intelligence de marché multi-source : échec, poursuite avec le résultat existant",
        );
      }
    }
  }

  const fused = marketIntelligence?.fused;
  const useFusedValuation = fused !== undefined && fused.status === "estimated";

  const netProfitFromFusion = useFusedValuation
    ? computeNetProfit(
        { sampleSize: fused.evidenceCount, medianCents: fused.fairCents!, p25Cents: fused.lowCents!, p75Cents: fused.highCents!, conservativeCents: fused.lowCents! },
        { purchasePriceCents: listing.priceCents, ...DEFAULT_COST_ASSUMPTIONS },
      )
    : null;
  const dealScoreFromFusion = useFusedValuation ? computeDealScore(netProfitFromFusion) : null;
  const fusedDecision = useFusedValuation ? decideFromFusedValuation(fused!, dealScoreFromFusion) : null;

  const marketEvidence = marketIntelligence
    ? {
        strongestTier: fused!.strongestTier,
        sourceCount: fused!.sourceCount,
        observationCount: marketIntelligence.observationCount,
        liveObservationCount: marketIntelligence.liveObservationCount,
        historicalObservationCount: marketIntelligence.historicalObservationCount,
        sourceNames: marketIntelligence.sourceNames,
        retailOnlyWarning: fused!.strongestTier === "E",
        activeListingsOnlyWarning: fused!.strongestTier === "C" || fused!.strongestTier === "D",
        usedSpecialistHistory: fused!.evidenceMix.some((e) => e.tier === "B"),
        directSourceCount: marketIntelligence.directSourceCount,
        aggregatorSourceCount: marketIntelligence.aggregatorSourceCount,
        evidenceTypeMix: marketIntelligence.evidenceTypeMix,
        costClassesUsed: marketIntelligence.costClassesUsed,
        fx: marketIntelligence.fx,
      }
    : undefined;

  const marketWarnings: string[] = [];
  if (marketEvidence?.retailOnlyWarning) marketWarnings.push("MARKET_EVIDENCE_RETAIL_ONLY");
  if (marketEvidence?.activeListingsOnlyWarning) marketWarnings.push("MARKET_EVIDENCE_ACTIVE_LISTINGS_ONLY");

  const analysisResult: AnalysisResult = {
    product: {
      name: productName,
      category: listing.categorySlug,
      modelOrReference: extraction.product.model?.value ?? extraction.product.reference?.value ?? null,
    },
    conditionEstimated: condition,
    priceDetected: { amount: request.purchase_price, currency: listing.currency },
    marketValueEstimate: useFusedValuation
      ? { amount: fused!.fairCents! / 100, currency: fused!.currency, provenance: provenanceForEvidenceTier(fused!.strongestTier) }
      : pipelineResult.estimate
        ? {
            amount: pipelineResult.estimate.conservativeCents / 100,
            currency: listing.currency,
            // Reflète honnêtement `evidenceTier` (LOT "Universal Object
            // Valuation Foundation") — jamais "sold_transaction" pour une
            // estimation qui repose en réalité sur des annonces actives.
            provenance: usedSold ? "sold_transaction" : usedActiveListings ? "active_listing" : "unknown",
          }
        : null,
    resaleRangeConservative: useFusedValuation
      ? { low: fused!.lowCents! / 100, high: fused!.highCents! / 100, currency: fused!.currency }
      : pipelineResult.estimate
        ? { low: pipelineResult.estimate.p25Cents / 100, high: pipelineResult.estimate.p75Cents / 100, currency: listing.currency }
        : null,
    grossMargin: useFusedValuation
      ? netProfitFromFusion
        ? (netProfitFromFusion.resaleBasisCents - listing.priceCents) / 100
        : null
      : pipelineResult.netProfit
        ? (pipelineResult.netProfit.resaleBasisCents - listing.priceCents) / 100
        : null,
    estimatedFees: useFusedValuation
      ? netProfitFromFusion
        ? (netProfitFromFusion.platformFeeCents + netProfitFromFusion.riskReserveCents) / 100
        : null
      : pipelineResult.netProfit
        ? (pipelineResult.netProfit.platformFeeCents + pipelineResult.netProfit.riskReserveCents) / 100
        : null,
    netMargin: useFusedValuation
      ? netProfitFromFusion
        ? netProfitFromFusion.netProfitCents / 100
        : null
      : pipelineResult.netProfit
        ? pipelineResult.netProfit.netProfitCents / 100
        : null,
    confidenceScore: useFusedValuation ? fused!.confidence : pipelineResult.scores.confidence,
    liquidityScore: useFusedValuation ? estimateLiquidityFromFusedValuation(fused!) : pipelineResult.scores.liquidity,
    dealScore: useFusedValuation ? dealScoreFromFusion : pipelineResult.scores.deal,
    decision: useFusedValuation ? fusedDecision!.decision : pipelineResult.decision,
    warnings: [...baseWarnings, ...marketWarnings],
    reasons: useFusedValuation ? [fusedDecision!.reason, ...fused!.reasons] : pipelineResult.whyPanel.factors.map((f) => f.detail),
    dataAvailability: useFusedValuation
      ? { soldTransactions: fused!.strongestTier === "A", marketGuide: marketEvidence!.usedSpecialistHistory }
      : { soldTransactions: usedSold, marketGuide: false },
    ...(marketEvidence ? { marketEvidence } : {}),
  };

  const finalDecision = useFusedValuation ? fusedDecision!.decision : pipelineResult.decision;
  await writeResult(db, analysisRequestId, finalDecision === "INSUFFICIENT_DATA" ? "insufficient_data" : "completed", analysisResult);
}
