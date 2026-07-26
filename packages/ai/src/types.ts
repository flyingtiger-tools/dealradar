import type { ExtractedProduct, FieldSource } from "./validation/schemas";

export type { ExtractedProduct, FieldSource };

export interface ExtractionImage {
  url: string;
  position: number;
}

/**
 * Entrée du moteur d'extraction — volontairement indépendante de toute
 * marketplace : `providedAttributes` porte les aspects bruts déjà connus
 * (ex. eBay `localizedAspects`), traités comme une source `"provided"` au
 * même titre que le déterministe ou l'IA, jamais privilégiés par défaut.
 */
export interface ExtractionInput {
  title: string;
  description?: string | null;
  categorySlug: string;
  images: ExtractionImage[];
  providedAttributes?: Record<string, string | number | boolean>;
}

/** Une extraction candidate produite par une seule source, avant fusion. */
export interface SourcedExtraction {
  source: FieldSource;
  product: ExtractedProduct;
}

export type ExtractionSource = "deterministic" | "cache" | "ai";

export type ExtractionWarningCode =
  | "MAJOR_CONTRADICTION"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_ERROR"
  | "PROVIDER_TIMEOUT"
  | "INVALID_PROVIDER_RESPONSE"
  | "IMAGE_REJECTED";

export interface ExtractionWarning {
  code: ExtractionWarningCode;
  message: string;
  field?: string;
  candidates?: unknown[];
}

export type CacheStatus = "hit" | "miss" | "not_applicable";
export type ExtractionStatus = "success" | "error" | "skipped";

/**
 * Télémétrie retournée à l'appelant pour journalisation/persistance — jamais
 * calculée ou affichée comme une facture officielle du provider, seulement
 * une estimation dérivée des unités retournées par l'API et de
 * `cost-table.ts` (versionnée).
 */
export interface ExtractionTelemetry {
  provider: string | null;
  model: string | null;
  inputUnits: number;
  outputUnits: number;
  imageCount: number;
  latencyMs: number;
  cacheStatus: CacheStatus;
  estimatedCostUsd: number;
  status: ExtractionStatus;
  errorCode?: string;
}

export interface ExtractionResult {
  product: ExtractedProduct;
  extractedAt: string;
  source: ExtractionSource;
  warnings: ExtractionWarning[];
  telemetry: ExtractionTelemetry;
}
