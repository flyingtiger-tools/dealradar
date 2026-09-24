import type { SupabaseClient } from "@supabase/supabase-js";
import { extractTcgCardFromPhoto, isSufficientForAutoCorroboration, type ExtractTcgCardOptions, type TcgCardExtraction } from "@dealradar/ai";
import { deriveCollectorNumberForCatalogQuery, type CatalogConnector, type FxRateProvider, type PricingConnector, type TcgCatalogHints } from "@dealradar/connectors";
import type { TcgCardAnalysisResult, TcgCardExtractedFields, TcgCardProvidedHints } from "@dealradar/core";
import { orchestratePokemonPipeline } from "./orchestrate-pokemon-pipeline";

/**
 * Branche `pokemon_tcg` de l'analyse (LOT 8, mobile) — identifie une carte
 * physique et rassemble ses observations de prix traçables, ne produit
 * jamais de décision BUY/REVIEW/PASS ni n'exige de prix d'achat. Réutilise
 * tel quel `orchestratePokemonPipeline()` (ADR 0012, LOT 3-7C) — aucune
 * règle de corroboration/pricing dupliquée ou modifiée ici.
 *
 * Déplacé depuis `apps/workers/src/jobs/process-tcg-card-analysis.ts` (lot
 * "journée autonome" — pipeline photo→ID→prix sans worker) : cette fonction
 * ne dépendait déjà d'aucun code spécifique aux workers au-delà d'un import
 * relatif (`../logger`) et d'un type de wiring de connecteurs — les deux
 * appelants réels (le job `analysis.process` d'`apps/workers`, ET le
 * nouvel endpoint serverless synchrone `apps/web/src/app/api/internal/tcg/
 * analyze`) ont besoin de la MÊME logique exacte, jamais une seconde
 * implémentation parallèle. Le logger est maintenant injecté (`deps.logger`,
 * optionnel) plutôt qu'importé en dur, pour rester utilisable depuis
 * n'importe quel runtime Node sans imposer `pino`.
 */

const SIGNED_URL_TTL_SECONDS = 300;
const STORAGE_BUCKET = "analysis-uploads";
const TARGET_CURRENCY = "CHF";

/** Wiring des connecteurs du pipeline Pokémon — même forme que l'ancien `TcgPipelineConnectors` d'`apps/workers`, déplacée ici pour être partagée par tout appelant (worker en file, ou endpoint serverless synchrone). */
export interface TcgPipelineConnectors {
  pokemonCatalogConnector: CatalogConnector;
  tcgdexCatalogConnector: CatalogConnector;
  justTcgPricingConnector: PricingConnector;
  tcgdexPricingConnector: PricingConnector;
  fxProvider: FxRateProvider;
}

/** Logger minimal injectable — jamais une dépendance dure à `pino` dans ce package partagé. Un appelant qui ne fournit rien obtient un no-op silencieux (jamais un crash pour un simple diagnostic manquant). */
export interface MinimalLogger {
  warn(obj: Record<string, unknown>, message: string): void;
  error(obj: Record<string, unknown>, message: string): void;
}

const NOOP_LOGGER: MinimalLogger = { warn: () => undefined, error: () => undefined };

export interface TcgCardAnalysisDeps {
  extractionOptions: ExtractTcgCardOptions | undefined;
  connectors: TcgPipelineConnectors | undefined;
  logger?: MinimalLogger;
}

function extractStoragePath(imageUrl: string): string | null {
  const marker = `/${STORAGE_BUCKET}/`;
  const index = imageUrl.indexOf(marker);
  if (index === -1) return null;
  // La partie après le marqueur peut porter des paramètres de requête (jamais attendus ici, mais retirés par prudence).
  return imageUrl.slice(index + marker.length).split("?")[0] ?? null;
}

function emptyTcgResult(warnings: string[], reason: string | null): TcgCardAnalysisResult {
  return {
    kind: "pokemon_tcg_card",
    needsConfirmation: false,
    extractedFields: {
      category: "pokemon_tcg",
      game: null,
      cardName: null,
      setName: null,
      cardNumber: null,
      variant: null,
      language: null,
      productKind: null,
      gradingCompany: null,
      grade: null,
      confidence: 0,
      warnings,
    },
    identity: null,
    priceObservations: [],
    warnings,
    reason,
  };
}

function extractionToFields(extraction: TcgCardExtraction, warnings: string[]): TcgCardExtractedFields {
  return {
    category: "pokemon_tcg",
    game: extraction.game.value,
    cardName: extraction.cardName.value,
    setName: extraction.setName.value,
    cardNumber: extraction.cardNumber.value,
    variant: extraction.variant.value,
    language: extraction.language.value,
    productKind: extraction.productKind.value,
    gradingCompany: extraction.gradingCompany.value,
    grade: extraction.grade.value,
    confidence: extraction.overallConfidence,
    warnings,
  };
}

/** Les deux catalogues nomment le set de 1999 "Base", alors que l'usage courant (et l'extraction visuelle) dit souvent "Base Set". Ne normalise que cet alias vérifié : le nom affiché à l'utilisateur reste inchangé. */
function catalogSetName(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.trim().toLowerCase() === "base set" ? "Base" : value;
}

function hintsFromExtraction(extraction: TcgCardExtraction): TcgCatalogHints {
  return {
    kind: extraction.productKind.value ?? undefined,
    name: extraction.cardName.value ?? undefined,
    setName: catalogSetName(extraction.setName.value),
    collectorNumber: deriveCollectorNumberForCatalogQuery(extraction.cardNumber.value),
    language: extraction.language.value ?? undefined,
    gradingCompany: (extraction.gradingCompany.value as TcgCatalogHints["gradingCompany"]) ?? undefined,
    grade: extraction.grade.value ?? undefined,
    extra: extraction.variant.value ? { variant: extraction.variant.value } : undefined,
  };
}

function hintsFromProvided(hints: TcgCardProvidedHints): TcgCatalogHints {
  return {
    kind: hints.productKind ?? undefined,
    name: hints.cardName ?? undefined,
    setName: catalogSetName(hints.setName),
    collectorNumber: deriveCollectorNumberForCatalogQuery(hints.cardNumber),
    language: hints.language ?? undefined,
    gradingCompany: (hints.gradingCompany as TcgCatalogHints["gradingCompany"]) ?? undefined,
    grade: hints.grade ?? undefined,
    extra: hints.variant ? { variant: hints.variant } : undefined,
  };
}

export async function processTcgCardAnalysis(
  db: SupabaseClient,
  request: {
    id: string;
    imageReferences: { url: string }[];
    providedTcgHints: TcgCardProvidedHints | null;
  },
  deps: TcgCardAnalysisDeps,
): Promise<{ status: "completed" | "insufficient_data" | "failed"; result: TcgCardAnalysisResult }> {
  const logger = deps.logger ?? NOOP_LOGGER;

  // Cas 1 : l'utilisateur a déjà corrigé/confirmé les champs sur l'écran de
  // confirmation — aucune ré-extraction visuelle, corroboration directe.
  if (request.providedTcgHints) {
    if (!deps.connectors) {
      return { status: "failed", result: emptyTcgResult(["TCG_PIPELINE_UNAVAILABLE"], "Pipeline de pricing TCG non configuré (JUSTTCG_API_KEY absent).") };
    }
    return runPipelineAndBuildResult(db, hintsFromProvided(request.providedTcgHints), deps.connectors, {
      category: "pokemon_tcg",
      game: null,
      cardName: request.providedTcgHints.cardName,
      setName: request.providedTcgHints.setName,
      cardNumber: request.providedTcgHints.cardNumber,
      variant: request.providedTcgHints.variant,
      language: request.providedTcgHints.language,
      productKind: request.providedTcgHints.productKind,
      gradingCompany: request.providedTcgHints.gradingCompany,
      grade: request.providedTcgHints.grade,
      confidence: 1,
      warnings: [],
    });
  }

  const firstImage = request.imageReferences[0];
  if (!firstImage) {
    return { status: "insufficient_data", result: emptyTcgResult(["IMAGE_REQUIRED"], "Aucune photo fournie.") };
  }
  const storagePath = extractStoragePath(firstImage.url);
  if (!storagePath) {
    return { status: "failed", result: emptyTcgResult(["INVALID_IMAGE_REFERENCE"], "Référence d'image hors du stockage attendu.") };
  }

  // Suppression garantie une fois le traitement de CETTE photo terminé,
  // succès ou échec — mécanisme fiable côté serveur (le nettoyage tenté
  // côté mobile après le polling est une optimisation, pas la garantie :
  // il dépend de l'application restée ouverte jusqu'au résultat).
  try {
    return await processWithPhoto(db, request, storagePath, deps, logger);
  } finally {
    const { error: removeError } = await db.storage.from(STORAGE_BUCKET).remove([storagePath]);
    if (removeError) {
      logger.warn({ analysisRequestId: request.id, message: removeError.message }, "Suppression de la photo TCG après traitement impossible (best-effort)");
    }
  }
}

async function processWithPhoto(
  db: SupabaseClient,
  request: { id: string },
  storagePath: string,
  deps: TcgCardAnalysisDeps,
  logger: MinimalLogger,
): Promise<{ status: "completed" | "insufficient_data" | "failed"; result: TcgCardAnalysisResult }> {
  if (!deps.extractionOptions) {
    return { status: "failed", result: emptyTcgResult(["AI_EXTRACTION_UNAVAILABLE"], "Extraction visuelle non configurée (IA absente).") };
  }

  const { data: signed, error: signError } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    logger.error({ analysisRequestId: request.id, message: signError?.message }, "Impossible de générer une URL signée pour la photo TCG");
    return { status: "failed", result: emptyTcgResult(["IMAGE_UNAVAILABLE"], "Photo introuvable dans le stockage.") };
  }

  const extractionResult = await extractTcgCardFromPhoto(
    { imageStorageKey: storagePath, imageUrl: signed.signedUrl },
    deps.extractionOptions,
  );
  // Diagnostic minimal sur échec provider — jamais x-api-key/Authorization
  // (jamais capturés au-delà de ce point), jamais l'image ou le corps brut
  // de la réponse (le message est déjà nettoyé par construction, voir
  // `extract-tcg-card.ts`), jamais les champs extraits eux-mêmes (peuvent
  // contenir du texte lu sur la carte de l'utilisateur). `invalidIssues` ne
  // porte que la structure d'un échec de schéma (chemin/code/type), jamais
  // la valeur d'un champ — sauf `received` sur un enum invalide, qui ne
  // porte que la valeur de ce champ précis (voir `ZodIssueSummary`).
  if (extractionResult.telemetry.status === "error") {
    logger.warn(
      {
        analysisRequestId: request.id,
        provider: extractionResult.telemetry.provider,
        model: extractionResult.telemetry.model,
        httpStatus: extractionResult.telemetry.errorHttpStatus,
        errorCode: extractionResult.telemetry.errorCode,
        errorMessage: extractionResult.telemetry.errorMessage,
        invalidPaths: extractionResult.telemetry.invalidPaths,
        invalidCodes: extractionResult.telemetry.invalidCodes,
        invalidIssues: extractionResult.telemetry.invalidIssues,
      },
      "Extraction IA TCG : échec provider",
    );
  }
  const extractionFields = extractionToFields(extractionResult.extraction, extractionResult.warnings);

  if (!isSufficientForAutoCorroboration(extractionResult.extraction)) {
    return {
      status: "insufficient_data",
      result: {
        kind: "pokemon_tcg_card",
        needsConfirmation: true,
        extractedFields: extractionFields,
        identity: null,
        priceObservations: [],
        warnings: extractionResult.warnings,
        reason: "Extraction visuelle insuffisante pour une identification fiable — confirmation utilisateur requise.",
      },
    };
  }

  if (!deps.connectors) {
    return {
      status: "failed",
      result: {
        kind: "pokemon_tcg_card",
        needsConfirmation: false,
        extractedFields: extractionFields,
        identity: null,
        priceObservations: [],
        warnings: [...extractionResult.warnings, "TCG_PIPELINE_UNAVAILABLE"],
        reason: "Pipeline de pricing TCG non configuré (JUSTTCG_API_KEY absent).",
      },
    };
  }

  return runPipelineAndBuildResult(db, hintsFromExtraction(extractionResult.extraction), deps.connectors, extractionFields);
}

async function runPipelineAndBuildResult(
  db: SupabaseClient,
  hints: TcgCatalogHints,
  connectors: TcgPipelineConnectors,
  extractedFields: TcgCardExtractedFields,
): Promise<{ status: "completed" | "insufficient_data" | "failed"; result: TcgCardAnalysisResult }> {
  const pipelineResult = await orchestratePokemonPipeline({
    supabase: db,
    ...connectors,
    categorySlug: "pokemon_tcg",
    hints: hints as unknown as Record<string, unknown>,
    targetCurrency: TARGET_CURRENCY,
  });

  if (!pipelineResult.candidate) {
    return {
      status: "insufficient_data",
      result: {
        kind: "pokemon_tcg_card",
        needsConfirmation: false,
        extractedFields,
        identity: null,
        priceObservations: [],
        warnings: pipelineResult.warnings,
        reason: pipelineResult.reason ?? "Identification ou pricing non aboutis.",
      },
    };
  }

  const candidate = pipelineResult.candidate;
  // La carte peut être identifiée avec confiance (catalogue corroboré) sans
  // qu'aucune source de pricing n'ait produit de correspondance exacte —
  // `candidate.priceObservations` est alors vide mais `candidate` lui-même
  // reste renseigné (voir orchestrate-pokemon-pipeline.ts, qui ne renvoie
  // `stage: "ready_for_intelligence_core"` que lorsqu'au moins un
  // exact_match a été accepté). Distinguer ce cas de "insufficient_data"
  // avec identity:null (échec d'identification réel) est précisément ce qui
  // permet au mobile d'afficher "Carte identifiée, prix temporairement
  // indisponible" au lieu d'un échec total.
  return {
    status: pipelineResult.stage === "ready_for_intelligence_core" ? "completed" : "insufficient_data",
    result: {
      kind: "pokemon_tcg_card",
      needsConfirmation: false,
      extractedFields,
      identity: {
        catalogExternalId: candidate.catalogExternalId,
        game: candidate.game,
        name: candidate.name,
        setName: candidate.setName,
        cardNumber: candidate.cardNumber,
        variant: candidate.variant,
        language: candidate.language,
        productKind: candidate.productKind,
        gradingCompany: candidate.gradingCompany,
        grade: candidate.grade,
        confidence: candidate.confidence,
        catalogCorroboration: candidate.catalogCorroboration,
      },
      priceObservations: candidate.priceObservations.map((entry) => ({
        source: entry.source,
        provenance: entry.provenance,
        amountCents: entry.amountCents,
        currency: entry.currency,
        condition: entry.condition,
        variant: entry.variant,
        language: entry.language,
        gradingCompany: entry.gradingCompany,
        grade: entry.grade,
        region: entry.region,
        updatedAt: entry.updatedAt,
        conversion: entry.conversion,
        warnings: entry.warnings,
      })),
      warnings: candidate.warnings,
      reason: null,
    },
  };
}
