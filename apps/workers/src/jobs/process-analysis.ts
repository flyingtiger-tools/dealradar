import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runIntelligencePipeline,
  resolveCategoryProfile,
  buildSearchQueries,
  computeNetProfit,
  computeDealScore,
  decideFromFusedValuation,
  createCanonicalProductIdentity,
  deriveProductKey,
  mergeIdentityEvidence,
  decideNextSnapshotRefresh,
  DEFAULT_REFRESH_BUDGET_LIMITS,
  initialRefreshBudgetState,
  normalizeCondition,
  type AnalysisProcessPayload,
  type AnalysisResult,
  type CostInputs,
  type NormalizedComparable,
  type NormalizedListing,
  type FusedValuation,
  type EvidenceQualityTier,
  type IdentityField,
  type CanonicalProductIdentity,
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
  gatherActiveListingEvidence,
  signStorageImageUrl,
  orchestrateMarketIntelligence,
  persistCanonicalProductIdentity,
  persistResearchTarget,
  buildSourceSelectionPlan,
  queryProductHistory,
  toFusionHistoryContext,
  loadSourceHealthStates,
  updateSourceHealthFromDiagnostics,
  persistSourceHealthState,
  toHealthLevels,
  enrichProductIdentity,
  type SoldListingRow,
  type IdentityHints,
} from "@dealradar/ingestion";
import { logger } from "../logger";
import { buildAiExtractionConfigFromEnv } from "../ingestion/ai-provider-config";
import { buildTcgPipelineConnectorsFromEnv } from "../ingestion/tcg-connector-config";
import { tryBuildEbayConnectorFromEnv } from "../ingestion/connector-config";
import { buildMarketSourcesFromEnv, computeEnvPresenceBySource } from "../ingestion/market-source-factory";
import { buildCatalogSourcesFromEnv, createCachedCatalogLookup, sharedCatalogLookupCache } from "../ingestion/catalog-source-factory";
import { sharedFxRateProvider } from "../ingestion/fx-provider";
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
  /**
   * Annulation INTERACTIVE demandée par le propriétaire (LOT "Product
   * History UX + Source Health + Interactive Cancellation + Beta
   * Readiness", section 6/7 ; migration 0026, RPC
   * `request_analysis_cancellation`). `null` -> aucune annulation
   * demandée. Une valeur non-null AVANT toute étape coûteuse (extraction
   * IA, orchestration multi-source) fait sortir `processAnalysis` tôt via
   * `writeCancelled` — jamais traité comme une panne fournisseur, jamais
   * un `AnalysisResult` fabriqué.
   */
  cancel_requested_at: string | null;
  /**
   * Code-barres EXACT déjà normalisé côté client (LOT "Live Identity
   * Enrichment + Barcode-First + upc.dev Fallback + Railway Readiness",
   * section 1/2 ; migration 0027) — `null` = aucun code-barres exploitable
   * détecté. N'a de sens que pour le chemin GÉNÉRIQUE, jamais consommé par
   * la branche `pokemon_tcg` ci-dessous.
   */
  barcode: string | null;
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

/**
 * Écrit l'état terminal `"cancelled"` (LOT "Product History UX + Source
 * Health + Interactive Cancellation + Beta Readiness", section 6/7) —
 * TOUJOURS `result: null` : une annulation utilisateur n'est jamais une
 * panne fournisseur et ne doit jamais produire un `AnalysisResult`
 * fabriqué à partir d'un travail partiel.
 */
async function writeCancelled(db: SupabaseClient, analysisRequestId: string): Promise<void> {
  const { error } = await db
    .from("analysis_requests")
    .update({ status: "cancelled", result: null, updated_at: new Date().toISOString() })
    .eq("id", analysisRequestId);
  if (error) throw new Error(`Écriture de l'annulation impossible : ${error.message}`);
}

/**
 * Relecture FRAÎCHE de `cancel_requested_at` (jamais la valeur capturée au
 * début de `processAnalysis` — une annulation peut être demandée PENDANT
 * l'extraction IA, qui peut prendre plusieurs secondes) — utilisée
 * uniquement juste avant l'étape coûteuse suivante (orchestration
 * multi-source), jamais comme substitut du contrôle initial.
 */
async function isCancellationRequested(db: SupabaseClient, analysisRequestId: string): Promise<boolean> {
  const { data } = await db
    .from("analysis_requests")
    .select("cancel_requested_at")
    .eq("id", analysisRequestId)
    .maybeSingle();
  return Boolean((data as { cancel_requested_at: string | null } | null)?.cancel_requested_at);
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
    .select("id,title,description,category_slug,purchase_price,currency,image_references,source_type,provided_tcg_hints,cancel_requested_at,barcode")
    .eq("id", analysisRequestId)
    .maybeSingle();
  const request = row as AnalysisRequestRow | null;
  if (!request) {
    logger.warn({ analysisRequestId }, "Requête d'analyse introuvable, traitement ignoré");
    return;
  }

  // Annulation demandée AVANT tout traitement (LOT "Product History UX...",
  // section 6/7) — contrôle initial, commun aux deux branches (TCG et
  // générique) ci-dessous : ni extraction IA, ni orchestration multi-source
  // ne démarrent jamais pour un cycle déjà annulé.
  if (request.cancel_requested_at) {
    await writeCancelled(db, analysisRequestId);
    logger.info({ analysisRequestId }, "Analyse annulée par l'utilisateur avant traitement — aucun appel IA/marché déclenché");
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

  // Résolution de `productKey` (LOT "Interactive History + Generic Result
  // UI + Full Cancellation + Pre-Prod Activation Package", section 2) —
  // CENTRALISÉE ici et réutilisée pour l'amorçage de cible ci-dessous ET
  // pour la lecture d'historique plus bas : une seule dérivation, jamais
  // deux clés potentiellement différentes pour le même scan. Inclut
  // `storage`/`color` (`deriveProductKey` les supporte déjà) — leur
  // absence ici AVANT ce lot faisait dériver la MÊME clé pour un iPhone 15
  // Pro 128 Go et 256 Go (bug latent réel : deux produits distincts
  // auraient fusionné leur historique/observations sous une seule
  // `productKey`). `capacity` (extraction IA) porte le rôle de `storage`
  // (`IdentityField`) — aucun champ `storage` distinct n'existe côté
  // extraction générique aujourd'hui.
  const identitySeedFields: Partial<Record<IdentityField, string>> = {};
  if (extraction.product.brand?.value) identitySeedFields.brand = extraction.product.brand.value;
  if (extraction.product.model?.value) identitySeedFields.model = extraction.product.model.value;
  if (extraction.product.capacity?.value) identitySeedFields.storage = extraction.product.capacity.value;
  if (extraction.product.color?.value) identitySeedFields.color = extraction.product.color.value;

  // Enrichissement d'identité RÉEL par sources catalogue gratuites/ouvertes
  // (LOT "Live Identity Enrichment + Barcode-First + upc.dev Fallback +
  // Railway Readiness", section 1) — code-barres exact -> Open Food Facts
  // -> Open Products Facts -> Wikidata ; numéro de set LEGO exact ->
  // Rebrickable. Fusionné avec l'extraction IA via la politique de fusion
  // DÉJÀ testée (`enrichProductIdentity`, `@dealradar/ingestion` — voir son
  // en-tête pour le détail exact de l'ordre catalogue-avant-IA qui fait
  // gagner un identifiant exact sur un désaccord dur). ISOLÉ entièrement :
  // une panne catalogue (réseau, schéma inattendu) ne doit JAMAIS empêcher
  // l'analyse utilisateur — repli silencieux sur les champs IA seuls,
  // exactement le comportement d'AVANT ce lot.
  let enrichedFields: Partial<Record<IdentityField, string>> = identitySeedFields;
  let identityQuality: AnalysisResult["identityQuality"];
  let enrichedIdentityForSeeding: CanonicalProductIdentity | null = null;
  try {
    const { sources: catalogSources } = buildCatalogSourcesFromEnv();
    // Couche de cache PARTAGÉE au niveau process (LOT "Live Identity
    // Enrichment...", section 11) — même précédent que `sharedFxRateProvider` :
    // survit entre analyses, jamais recréée à chaque appel.
    const lookup = createCachedCatalogLookup(catalogSources, sharedCatalogLookupCache);
    const hints: IdentityHints = {
      barcode: request.barcode,
      legoSetNumber: listing.categorySlug === "lego" ? (extraction.product.reference?.value ?? null) : null,
      gamingTitle: listing.categorySlug === "gaming" ? productName : null,
    };
    const enrichResult = await enrichProductIdentity({
      categorySlug: listing.categorySlug,
      hints,
      aiFields: identitySeedFields,
      asOf: new Date().toISOString(),
      lookup,
    });
    enrichedFields = enrichResult.mergedFields;
    enrichedIdentityForSeeding = enrichResult.identity;
    identityQuality = {
      method: enrichResult.qualityMethod,
      sourcesConsulted: enrichResult.sourcesConsulted,
      conflicts: enrichResult.identity.conflicts.map((c) => ({
        field: c.field,
        aiValue: c.claims.find((claim) => claim.source === "ai_identification")?.value ?? null,
        catalogValue: c.claims.find((claim) => claim.source !== "ai_identification")?.value ?? null,
      })),
    };
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : "erreur inconnue" },
      "Enrichissement d'identité catalogue impossible — poursuite avec l'extraction IA seule",
    );
  }

  const productKey = deriveProductKey(listing.categorySlug, enrichedFields);

  // Amorçage de cible de recherche (LOT "Historical Data Engine", section
  // 14) — un scan utilisateur identifié avec succès (catégorie confirmée,
  // état détecté, prix d'achat confirmé : exactement ce que `listing`
  // représente à ce stade) peut amorcer un suivi de prix à long terme,
  // INDÉPENDAMMENT du résultat de l'estimation ci-dessous (BUY/PASS/
  // INSUFFICIENT_DATA n'a aucune influence sur cet amorçage). Isolé
  // volontairement : un échec d'écriture ici ne doit JAMAIS faire échouer
  // la requête d'analyse de l'utilisateur.
  try {
    // Réutilise l'identité DÉJÀ enrichie par catalogue ci-dessus (section 1)
    // — jamais une seconde fusion divergente à partir des seuls champs IA.
    // `productKey` corrigé ici : `enrichProductIdentity` ne le connaît pas
    // encore au moment où elle tourne (calculé juste après, ci-dessus) —
    // seul le `productKey` FINAL (reflétant un éventuel champ corrigé par
    // le catalogue, ex. storage) doit être persisté. Repli sur l'ancien
    // comportement (fusion IA seule) si l'enrichissement catalogue a
    // échoué entièrement plus haut — jamais un amorçage bloqué pour
    // autant.
    const seedIdentity: CanonicalProductIdentity = enrichedIdentityForSeeding
      ? { ...enrichedIdentityForSeeding, productKey }
      : mergeIdentityEvidence(createCanonicalProductIdentity(listing.categorySlug, productKey), {
          source: "ai_identification",
          confidence: 0.6,
          observedAt: new Date().toISOString(),
          fields: {
            brand: extraction.product.brand?.value,
            model: extraction.product.model?.value,
            sku: extraction.product.reference?.value,
            storage: extraction.product.capacity?.value,
            color: extraction.product.color?.value,
          },
        }).identity;

    const scheduling = decideNextSnapshotRefresh({
      asOf: new Date().toISOString(),
      lastRefreshedAt: null,
      priceVolatility: null,
      recentActivity: true,
      costClass: "free",
    });

    await persistCanonicalProductIdentity(db, seedIdentity);
    await persistResearchTarget(db, {
      productKey: seedIdentity.productKey,
      reason: "user_scan",
      priority: scheduling.priority,
      desiredCurrency: listing.currency,
      enabled: true,
      nextRefreshAt: scheduling.nextRefreshAt,
    });
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : "erreur inconnue" },
      "Amorçage de la cible de recherche a échoué — poursuite de l'analyse utilisateur sans cet amorçage",
    );
  }

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
  // Position du prix d'achat CONFIRMÉ (`listing.priceCents`) dans la
  // distribution historique connue — répond à "ce prix est-il bon par
  // rapport à l'historique", jamais une position de la valeur juste fusionnée
  // (qui n'existe pas encore à ce point, la fusion n'a pas encore tourné).
  // `null` tant qu'aucun historique exploitable n'a été lu.
  let currentVsHistoryPercentile: number | null = null;
  if (pipelineResult.decision === "INSUFFICIENT_DATA") {
    const { sources } = buildMarketSourcesFromEnv();

    // Santé PAR SOURCE (LOT "Product History UX + Source Health +
    // Interactive Cancellation + Beta Readiness", section 4/5) — même
    // fonction que `take-product-snapshot.ts` (chemin de rafraîchissement),
    // jamais une logique divergente. Lecture ISOLÉE : jamais bloquante.
    let sourceHealthStates: Awaited<ReturnType<typeof loadSourceHealthStates>> = {};
    try {
      sourceHealthStates = await loadSourceHealthStates(db, sources.map((s) => s.source));
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Lecture de l'état de santé des sources impossible — sélection sans signal de santé");
    }

    // `SourceSelectionPlan` EXACT (LOT "Real DB Integration + Exact Budget Enforcement...", section 4) — MÊME algorithme de sélection que le rafraîchissement en arrière-plan (`take-product-snapshot.ts`), jamais une logique divergente. Aucune identité canonique résolue à ce point du chemin interactif -> `identityHealth: null` (aucune exclusion pour faiblesse d'identité), budget à cible unique par défaut (un seul appel ponctuel, pas un run multi-cibles).
    const selectionPlan = buildSourceSelectionPlan({
      categorySlug: listing.categorySlug,
      envPresenceBySource: computeEnvPresenceBySource(),
      identityHealth: null,
      budgetState: initialRefreshBudgetState(Date.now()),
      budgetLimits: DEFAULT_REFRESH_BUDGET_LIMITS,
      sourceHealth: toHealthLevels(sourceHealthStates),
    });
    const bySourceName = new Map(sources.map((s) => [s.source, s] as const));
    const resolvedSources = selectionPlan.selectedSources.flatMap((name) => {
      const source = bySourceName.get(name);
      return source ? [source] : [];
    });
    if (resolvedSources.length > 0) {
      const targetAttributes: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(listing.attributes)) {
        if (typeof value === "string" || typeof value === "number") targetAttributes[key] = value;
      }
      // Contexte d'historique (LOT "Interactive History + Generic Result UI
      // + Full Cancellation + Pre-Prod Activation Package", section 1) —
      // ISOLÉ dans son propre try/catch : une table/migration absente ou
      // une panne de lecture ne doit JAMAIS empêcher l'analyse ni la
      // requête d'intelligence de marché ci-dessous (même discipline que
      // l'amorçage de cible plus haut). `toFusionHistoryContext` renvoie
      // `null` pour un historique vide -> `historyContext` reste `undefined`,
      // `fuseMarketObservations` se comporte alors EXACTEMENT comme avant
      // ce lot (aucun ancrage).
      let historyContext: Awaited<ReturnType<typeof toFusionHistoryContext>> = null;
      try {
        const productHistory = await queryProductHistory(db, productKey, {
          asOf: new Date().toISOString(),
          currentPriceCents: listing.priceCents,
        });
        historyContext = toFusionHistoryContext(productHistory.history, productHistory.freshnessHours);
        currentVsHistoryPercentile = productHistory.history.historicalPercentilePosition;
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : "erreur inconnue" },
          "Lecture de l'historique produit impossible — poursuite sans contexte d'historique (tables absentes ou migration non appliquée)",
        );
      }

      // Second contrôle d'annulation (section 6/7) — relecture FRAÎCHE
      // (`isCancellationRequested`, jamais `request.cancel_requested_at`
      // capturé au tout début) juste avant l'étape la plus coûteuse du
      // chemin générique : l'orchestration multi-source (appels réseau vers
      // jusqu'à 7 connecteurs). Une annulation demandée pendant l'extraction
      // IA ci-dessus est ainsi honorée avant le premier appel marché, jamais
      // après. Sort AVANT la mise à jour de santé par source plus bas
      // (jamais un cycle annulé comptabilisé comme succès/échec fournisseur).
      if (await isCancellationRequested(db, analysisRequestId)) {
        await writeCancelled(db, analysisRequestId);
        logger.info(
          { analysisRequestId },
          "Analyse annulée par l'utilisateur avant l'orchestration multi-source — aucun appel marché supplémentaire",
        );
        return;
      }

      try {
        // Bucket canonique (LOT "Data Quality Calibration...", section 5) — même normalisation que côté observations (`map-market-observations-to-fusion.ts`), sinon `isCompatibleWithTarget` comparerait un vocabulaire cible (`ItemConditionRaw`) à un vocabulaire source distinct par égalité de chaîne stricte, produisant de fausses exclusions.
        const normalizedTargetCondition = listing.condition ? normalizeCondition({ rawCondition: listing.condition }) : null;
        marketIntelligence = await orchestrateMarketIntelligence({
          categorySlug: listing.categorySlug,
          q: queries.exact || productName || listing.title,
          sources: resolvedSources,
          target: { currency: listing.currency, condition: normalizedTargetCondition === "unknown" ? null : normalizedTargetCondition, attributes: targetAttributes },
          // Résout automatiquement un taux pour chaque devise étrangère
          // réellement observée (LOT "Source Wave 3", section 1) — Frankfurter,
          // gratuit, mis en cache au niveau module (voir plus haut). Une
          // observation sans taux disponible/fiable reste écartée, jamais
          // devinée (voir `mapMarketObservationsToFusionObservations`).
          fxRateProvider: sharedFxRateProvider,
          persistence: { supabase: db },
          ...(historyContext ? { history: historyContext } : {}),
        });
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : "erreur inconnue" },
          "Intelligence de marché multi-source : échec, poursuite avec le résultat existant",
        );
      }

      // Mise à jour de santé ISOLÉE (section 4) — jamais bloquante pour le
      // résultat déjà calculé ci-dessus, même discipline que `take-product-
      // snapshot.ts`. Absente si `marketIntelligence` est resté `null`
      // (l'appel a échoué avant même de produire un `coverageReport`).
      if (marketIntelligence) {
        try {
          const updated = updateSourceHealthFromDiagnostics(sourceHealthStates, marketIntelligence.coverageReport.perSource, new Date().toISOString());
          for (const name of resolvedSources.map((s) => s.source)) {
            const state = updated[name];
            if (state) await persistSourceHealthState(db, state);
          }
        } catch (error) {
          logger.warn({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Mise à jour de l'état de santé des sources impossible — analyse non affectée");
        }
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
        // LOT "Data Quality Calibration...", section 10, puis LOT
        // "Interactive History...", section 1 — porté tel quel depuis
        // `FusedValuation` (déjà calculé par `fuseMarketObservations`,
        // jamais recalculé ici). Non `null` dès que `queryProductHistory`
        // (appelé plus haut, isolé dans son propre try/catch) a trouvé un
        // historique exploitable pour `productKey` — sinon honnêtement
        // absents plutôt que devinés (aucune table historique, historique
        // vide, ou panne de lecture isolée).
        qualityFlags: fused!.qualityFlags,
        historicalReferenceMedianCents: fused!.historicalReferenceMedianCents,
        trendDescriptor: fused!.trendDescriptor,
        trendConfidence: fused!.trendConfidence,
        // Position du prix d'achat CONFIRMÉ dans l'historique — jamais celle
        // de la valeur juste fusionnée (voir le commentaire à la déclaration
        // de `currentVsHistoryPercentile` plus haut).
        currentVsHistoryPercentile,
      }
    : undefined;

  const marketWarnings: string[] = [];
  if (marketEvidence?.retailOnlyWarning) marketWarnings.push("MARKET_EVIDENCE_RETAIL_ONLY");
  if (marketEvidence?.activeListingsOnlyWarning) marketWarnings.push("MARKET_EVIDENCE_ACTIVE_LISTINGS_ONLY");

  const analysisResult: AnalysisResult = {
    productKey,
    product: {
      name: productName,
      category: listing.categorySlug,
      // `enrichedFields.model` (LOT "Live Identity Enrichment...", section
      // 1/12) prime sur l'extraction IA brute UNIQUEMENT si le catalogue
      // exact a réellement corroboré/corrigé un modèle (ex. le nom OFFICIEL
      // d'un set LEGO Rebrickable) — repli sur l'extraction IA sinon,
      // comportement identique à avant ce lot.
      modelOrReference: enrichedFields.model ?? extraction.product.model?.value ?? extraction.product.reference?.value ?? null,
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
    // Absent uniquement si l'enrichissement catalogue a levé une exception
    // NON attrapée par son propre try/catch (ne devrait jamais arriver,
    // filet de sécurité honnête plutôt qu'un objet fabriqué) — voir
    // `identityQuality` plus haut.
    ...(identityQuality ? { identityQuality } : {}),
  };

  const finalDecision = useFusedValuation ? fusedDecision!.decision : pipelineResult.decision;
  await writeResult(db, analysisRequestId, finalDecision === "INSUFFICIENT_DATA" ? "insufficient_data" : "completed", analysisResult);
}
