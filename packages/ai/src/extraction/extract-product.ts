import { itemConditionSchema } from "@dealradar/contracts";
import { runDeterministicExtractor, DETERMINISTIC_EXTRACTOR_VERSION } from "../parser/deterministic-extractor";
import { resolveRequirementProfile, isSufficientForIdentification } from "../parser/requirement-profiles";
import { mergeExtractions } from "./merge";
import { selectAllowedImages } from "../image-policy/select-and-validate-images";
import { computeImageFingerprint } from "../cache/image-fingerprint";
import { computeTextFingerprint, computeCacheKey } from "../cache/compute-key";
import { buildPrompt, PROMPT_VERSION } from "../prompts/build-prompt";
import { rawProviderResponseSchema, type RawProviderResponse } from "../validation/schemas";
import { estimateCostUsd, findCostTableEntry } from "../observability/cost-table";
import { buildTelemetry } from "../observability/telemetry";
import type { AIProvider } from "../provider/types";
import type { ExtractionCache } from "../cache/types";
import type { BudgetGuard } from "../budget/types";
import type { ExtractedProduct, ExtractionInput, ExtractionResult, ExtractionWarning, SourcedExtraction } from "../types";

/** Incrémenté à chaque changement de forme d'`ExtractedProduct` — entre dans la clé de cache. */
export const EXTRACTION_SCHEMA_VERSION = 1;

const DEFAULT_PROVIDED_ATTRIBUTE_CONFIDENCE = 0.5;
const CACHE_TTL_DAYS_WITH_CONTENT_HASH = 30;
const CACHE_TTL_DAYS_URL_FALLBACK = 1;
const MAX_ESTIMATE_INPUT_TOKENS_BASE = 2000;
const MAX_ESTIMATE_INPUT_TOKENS_PER_IMAGE = 300;
const MAX_ESTIMATE_OUTPUT_TOKENS = 500;

export interface ExtractProductOptions {
  provider?: AIProvider;
  cache?: ExtractionCache;
  budgetGuard?: BudgetGuard;
  maxImages?: number;
  imageDomainAllowlist?: string[];
  providedAttributeConfidence?: number;
}

function emptySourcedProduct(source: SourcedExtraction["source"]): ExtractedProduct {
  return {
    brand: null,
    model: null,
    reference: null,
    category: null,
    subcategory: null,
    condition: null,
    language: null,
    color: null,
    capacity: null,
    accessories: null,
    serialNumberDetected: { value: false, confidence: 0.5, source },
    attributes: {},
  };
}

function providedToSourcedExtraction(
  providedAttributes: Record<string, string | number | boolean> | undefined,
  confidence: number,
): SourcedExtraction | null {
  if (!providedAttributes || Object.keys(providedAttributes).length === 0) return null;
  const product = emptySourcedProduct("provided");
  for (const [key, value] of Object.entries(providedAttributes)) {
    product.attributes[key] = { value, confidence, source: "provided" };
  }
  return { source: "provided", product };
}

function rawToSourcedExtraction(raw: RawProviderResponse): SourcedExtraction {
  const confidenceMap = raw.confidence ?? {};
  const conf = (key: string, fallback = 0.6) => confidenceMap[key] ?? fallback;

  const product = emptySourcedProduct("ai");

  const strField = (value: string | null | undefined, key: string) =>
    value ? { value, confidence: conf(key), source: "ai" as const } : null;

  product.brand = strField(raw.brand, "brand");
  product.model = strField(raw.model, "model");
  product.reference = strField(raw.reference, "reference");
  product.category = strField(raw.category, "category");
  product.subcategory = strField(raw.subcategory, "subcategory");
  product.language = strField(raw.language, "language");
  product.color = strField(raw.color, "color");
  product.capacity = strField(raw.capacity, "capacity");
  product.accessories =
    raw.accessories && raw.accessories.length > 0
      ? { value: raw.accessories, confidence: conf("accessories"), source: "ai" }
      : null;

  if (raw.condition) {
    const parsedCondition = itemConditionSchema.safeParse(raw.condition);
    product.condition = parsedCondition.success
      ? { value: parsedCondition.data, confidence: conf("condition"), source: "ai" }
      : null;
  }

  product.serialNumberDetected = {
    value: raw.serialNumberDetected ?? false,
    confidence: conf("serialNumberDetected", 0.7),
    source: "ai",
  };

  for (const [key, value] of Object.entries(raw.attributes ?? {})) {
    product.attributes[key] = { value, confidence: conf(key), source: "ai" };
  }

  return { source: "ai", product };
}

function buildResult(
  product: ExtractedProduct,
  warnings: ExtractionWarning[],
  source: ExtractionResult["source"],
  startedAt: number,
  extra: Partial<Parameters<typeof buildTelemetry>[0]> = { status: "success" },
): ExtractionResult {
  return {
    product,
    extractedAt: new Date().toISOString(),
    source,
    warnings,
    telemetry: buildTelemetry({ ...extra, status: extra.status ?? "success", latencyMs: Date.now() - startedAt }),
  };
}

/**
 * Orchestrateur public — ordre strict et paresseux (correction 5) :
 * déterministe d'abord, images/fingerprint/cache calculés seulement si
 * l'IA est réellement nécessaire, budget réservé juste avant l'appel
 * réseau, jamais avant.
 */
export async function extractProduct(input: ExtractionInput, options: ExtractProductOptions = {}): Promise<ExtractionResult> {
  const startedAt = Date.now();

  const deterministic = runDeterministicExtractor(input);
  const provided = providedToSourcedExtraction(
    input.providedAttributes,
    options.providedAttributeConfidence ?? DEFAULT_PROVIDED_ATTRIBUTE_CONFIDENCE,
  );
  const requirementProfile = resolveRequirementProfile(input.categorySlug);
  const criticalKeys = requirementProfile?.attributeKeys ?? [];

  const initialCandidates: SourcedExtraction[] = [deterministic, ...(provided ? [provided] : [])];
  const { product: initialProduct, warnings: initialWarnings } = mergeExtractions(initialCandidates, criticalKeys);

  if (isSufficientForIdentification(initialProduct.attributes, input.categorySlug)) {
    return buildResult(initialProduct, initialWarnings, "deterministic", startedAt);
  }

  if (!options.provider) {
    return buildResult(initialProduct, initialWarnings, "deterministic", startedAt);
  }
  const provider = options.provider;

  // Insuffisant et IA disponible : sélection/fingerprint des images
  // seulement à partir d'ici — jamais avant (aucune annonce identifiable
  // par le texte ne déclenche de téléchargement/hachage d'image).
  const selectedImages = selectAllowedImages(input.images, {
    allowedDomains: options.imageDomainAllowlist ?? [],
    maxImages: options.maxImages,
  });

  const textFingerprint = computeTextFingerprint({
    title: input.title,
    description: input.description ?? null,
    categorySlug: input.categorySlug,
  });
  const { fingerprint: imageFingerprint, usedContentHash } = computeImageFingerprint(selectedImages);
  const contentFingerprint = selectedImages.length > 0 ? `${textFingerprint}:${imageFingerprint}` : textFingerprint;

  const cacheKey = computeCacheKey({
    provider: provider.name,
    model: provider.model,
    promptVersion: PROMPT_VERSION,
    schemaVersion: EXTRACTION_SCHEMA_VERSION,
    deterministicExtractorVersion: DETERMINISTIC_EXTRACTOR_VERSION,
    contentFingerprint,
  });

  if (options.cache) {
    const cached = await options.cache.get(cacheKey);
    if (cached) {
      const { product, warnings } = mergeExtractions(
        [...initialCandidates, { source: "ai", product: cached.product }],
        criticalKeys,
      );
      return buildResult(product, [...initialWarnings, ...warnings], "cache", startedAt, {
        provider: provider.name,
        model: provider.model,
        cacheStatus: "hit",
        status: "success",
      });
    }
  }

  const costEntry = findCostTableEntry(provider.name, provider.model);
  const maxCostEstimate =
    estimateCostUsd(
      {
        inputUnits: MAX_ESTIMATE_INPUT_TOKENS_BASE + selectedImages.length * MAX_ESTIMATE_INPUT_TOKENS_PER_IMAGE,
        outputUnits: MAX_ESTIMATE_OUTPUT_TOKENS,
      },
      costEntry,
    ) ?? 0;

  let reservationId: string | null = null;
  if (options.budgetGuard) {
    const reservation = await options.budgetGuard.reserve(maxCostEstimate);
    if (!reservation) {
      const warning: ExtractionWarning = {
        code: "BUDGET_EXCEEDED",
        message: "Budget IA journalier insuffisant pour cet appel : repli sur l'extraction déterministe.",
      };
      return buildResult(initialProduct, [...initialWarnings, warning], "deterministic", startedAt, {
        provider: provider.name,
        model: provider.model,
        status: "skipped",
        errorCode: "BUDGET_EXCEEDED",
      });
    }
    reservationId = reservation.reservationId;
  }

  const prompt = buildPrompt(input);
  const providerImages = selectedImages.map((image) => ({ url: image.url }));

  try {
    const response = await provider.extract({ system: prompt.system, userText: prompt.userText, images: providerImages });
    const estimatedCostUsd = estimateCostUsd(response.usage, costEntry) ?? 0;

    if (reservationId && options.budgetGuard) {
      await options.budgetGuard.finalize(reservationId, {
        status: "completed",
        inputUnits: response.usage.inputUnits,
        outputUnits: response.usage.outputUnits,
        estimatedCostUsd,
      });
    }

    const parsed = rawProviderResponseSchema.safeParse(response.raw);
    if (!parsed.success) {
      const warning: ExtractionWarning = {
        code: "INVALID_PROVIDER_RESPONSE",
        message: "Réponse IA invalide au regard du schéma attendu : repli sur l'extraction déterministe.",
      };
      return buildResult(initialProduct, [...initialWarnings, warning], "deterministic", startedAt, {
        provider: provider.name,
        model: provider.model,
        cacheStatus: "miss",
        inputUnits: response.usage.inputUnits,
        outputUnits: response.usage.outputUnits,
        imageCount: providerImages.length,
        estimatedCostUsd,
        status: "error",
        errorCode: "INVALID_PROVIDER_RESPONSE",
      });
    }

    const aiExtraction = rawToSourcedExtraction(parsed.data);
    const { product, warnings } = mergeExtractions([...initialCandidates, aiExtraction], criticalKeys);

    if (options.cache) {
      const ttlDays = usedContentHash ? CACHE_TTL_DAYS_WITH_CONTENT_HASH : CACHE_TTL_DAYS_URL_FALLBACK;
      await options.cache.set(cacheKey, {
        product: aiExtraction.product,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return buildResult(product, [...initialWarnings, ...warnings], "ai", startedAt, {
      provider: provider.name,
      model: provider.model,
      cacheStatus: "miss",
      inputUnits: response.usage.inputUnits,
      outputUnits: response.usage.outputUnits,
      imageCount: providerImages.length,
      estimatedCostUsd,
      status: "success",
    });
  } catch (error) {
    if (reservationId && options.budgetGuard) {
      await options.budgetGuard.finalize(reservationId, {
        status: "failed",
        inputUnits: 0,
        outputUnits: 0,
        estimatedCostUsd: 0,
      });
    }
    const errorCode = (error as { code?: string } | null)?.code ?? "UNKNOWN";
    const message = error instanceof Error ? error.message : "Erreur inconnue lors de l'appel au provider IA.";
    const warning: ExtractionWarning = {
      code: errorCode === "TIMEOUT" ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
      message,
    };
    return buildResult(initialProduct, [...initialWarnings, warning], "deterministic", startedAt, {
      provider: provider.name,
      model: provider.model,
      cacheStatus: "miss",
      status: "error",
      errorCode,
    });
  }
}
