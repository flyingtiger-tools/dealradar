import { normalizeEbayItem } from "@dealradar/connectors";
import {
  extractProduct,
  type AIProvider,
  type ExtractionCache,
  type ExtractedProduct,
} from "@dealradar/ai";
import { runIntelligencePipeline, type NormalizedComparable, type NormalizedListing, type CostInputs } from "@dealradar/core";
import type { ItemCondition } from "@dealradar/contracts";
import type { DatasetComparable, DatasetItem } from "../dataset/schema";
import type { CacheTimings } from "../instrumentation/timing-cache";
import type { ProviderTimings } from "../instrumentation/timing-provider";
import type { BenchmarkListingResult } from "../types";
import { DEFAULT_COST_ASSUMPTIONS } from "./cost-assumptions";

export interface RunListingOptions {
  categorySlug: string;
  asOf: string;
  provider?: AIProvider;
  cache?: ExtractionCache;
  cacheTimings?: CacheTimings;
  providerTimings?: ProviderTimings;
  imageDomainAllowlist: string[];
  candidatePool: NormalizedComparable[];
}

/** Fusionne les champs `ExtractedProduct.attributes` (valeur uniquement) dans un sac d'attributs existant. */
function mergeExtractedAttributes(
  existing: Record<string, string | number | boolean>,
  extracted: ExtractedProduct,
): Record<string, string | number | boolean> {
  const merged = { ...existing };
  for (const [key, entry] of Object.entries(extracted.attributes)) {
    if (entry) merged[key] = entry.value;
  }
  return merged;
}

/** Construit le pool de comparables une seule fois par dataset — jamais recalculé par annonce. */
export function buildComparablePool(comparables: DatasetComparable[], categorySlug: string, collectedAt: string): NormalizedComparable[] {
  const pool: NormalizedComparable[] = [];
  for (const comparable of comparables) {
    const normalized = normalizeEbayItem(comparable.raw, { categorySlug, collectedAt });
    if (!normalized || !normalized.condition) continue;
    pool.push({
      id: normalized.meta.externalId,
      sourceSlug: "ebay",
      title: normalized.title,
      priceCents: normalized.price.amountCents,
      currency: normalized.price.currency,
      condition: normalized.condition,
      categorySlug,
      attributes: normalized.attributes,
      soldAt: comparable.soldAt,
    });
  }
  return pool;
}

/**
 * Exécute une seule annonce du dataset à travers le pipeline réel, inchangé :
 * `normalizeEbayItem()` (connecteur) → `extractProduct()` (packages/ai) →
 * fusion des attributs → `runIntelligencePipeline()` (Intelligence Core).
 * Zéro logique dupliquée : seules les frontières sont chronométrées.
 */
export async function runListing(item: DatasetItem, options: RunListingOptions): Promise<BenchmarkListingResult> {
  const totalStart = performance.now();
  const mappingStart = performance.now();

  const normalized = normalizeEbayItem(item.raw, { categorySlug: options.categorySlug, collectedAt: options.asOf });
  if (!normalized) {
    return {
      itemId: item.raw.itemId ?? "unknown",
      usable: false,
      extractionSource: null,
      cacheHit: false,
      warnings: [],
      estimatedCostUsd: 0,
      decision: null,
      sufficiencyCorrect: null,
      timings: { mappingMs: performance.now() - mappingStart, extractionMs: 0, cacheMs: 0, providerMs: 0, intelligenceMs: 0, totalMs: performance.now() - totalStart },
    };
  }
  const mappingMsBeforeExtraction = performance.now() - mappingStart;

  const cacheBefore = options.cacheTimings ? { ...options.cacheTimings } : null;
  const providerBefore = options.providerTimings ? { ...options.providerTimings } : null;

  const extractionStart = performance.now();
  const result = await extractProduct(
    {
      title: normalized.title,
      description: normalized.description ?? null,
      categorySlug: options.categorySlug,
      images: normalized.images,
      providedAttributes: normalized.attributes,
    },
    {
      provider: options.provider,
      cache: options.cache,
      imageDomainAllowlist: options.imageDomainAllowlist,
    },
  );
  const extractionMs = performance.now() - extractionStart;

  const cacheMs = options.cacheTimings && cacheBefore ? options.cacheTimings.totalMs - cacheBefore.totalMs : 0;
  const providerMs = options.providerTimings && providerBefore ? options.providerTimings.totalMs - providerBefore.totalMs : 0;

  const mergeStart = performance.now();
  const mergedAttributes = mergeExtractedAttributes(normalized.attributes, result.product);
  const mergedCondition: ItemCondition | null = normalized.condition ?? result.product.condition?.value ?? null;
  const mappingMs = mappingMsBeforeExtraction + (performance.now() - mergeStart);

  const sufficiencyCorrect =
    item.expected?.sufficientDeterministic === undefined
      ? null
      : (result.source === "deterministic") === item.expected.sufficientDeterministic;

  if (!mergedCondition) {
    // Même règle que packages/ingestion/src/map-to-intelligence.ts : sans
    // condition connue, Intelligence Core n'est jamais appelé — l'annonce
    // est directement INSUFFICIENT_DATA, jamais une invention de condition.
    return {
      itemId: normalized.meta.externalId,
      usable: true,
      extractionSource: result.source,
      cacheHit: result.telemetry.cacheStatus === "hit",
      warnings: result.warnings,
      estimatedCostUsd: result.telemetry.estimatedCostUsd,
      decision: "INSUFFICIENT_DATA",
      sufficiencyCorrect,
      timings: {
        mappingMs,
        extractionMs,
        cacheMs,
        providerMs,
        intelligenceMs: 0,
        totalMs: performance.now() - totalStart,
      },
    };
  }

  const listing: NormalizedListing = {
    id: normalized.meta.externalId,
    sourceSlug: "ebay",
    title: normalized.title,
    description: normalized.description,
    priceCents: normalized.price.amountCents,
    currency: normalized.price.currency,
    condition: mergedCondition,
    categorySlug: options.categorySlug,
    attributes: mergedAttributes,
    postedAt: normalized.postedAt ?? undefined,
  };

  const costs: CostInputs = { purchasePriceCents: listing.priceCents, ...DEFAULT_COST_ASSUMPTIONS };

  const intelligenceStart = performance.now();
  const pipelineResult = runIntelligencePipeline({
    listing,
    candidates: options.candidatePool.filter((c) => c.currency === listing.currency),
    costs,
    asOf: options.asOf,
  });
  const intelligenceMs = performance.now() - intelligenceStart;

  return {
    itemId: normalized.meta.externalId,
    usable: true,
    extractionSource: result.source,
    cacheHit: result.telemetry.cacheStatus === "hit",
    warnings: result.warnings,
    estimatedCostUsd: result.telemetry.estimatedCostUsd,
    decision: pipelineResult.decision,
    sufficiencyCorrect,
    timings: {
      mappingMs,
      extractionMs,
      cacheMs,
      providerMs,
      intelligenceMs,
      totalMs: performance.now() - totalStart,
    },
  };
}
