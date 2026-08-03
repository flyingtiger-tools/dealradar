import { createHash } from "node:crypto";
import type { ZodError } from "zod";
import { buildTcgCardPrompt, TCG_CARD_PROMPT_VERSION } from "../prompts/build-tcg-card-prompt";
import { ProviderError } from "../provider/http";
import { rawTcgCardProviderResponseSchema, type RawTcgCardProviderResponse } from "../validation/tcg-card-schemas";
import { computeCacheKey } from "../cache/compute-key";
import { estimateCostUsd, findCostTableEntry } from "../observability/cost-table";
import { buildTelemetry } from "../observability/telemetry";
import type { AIProvider } from "../provider/types";
import type { ExtractionCache } from "../cache/types";
import type { BudgetGuard } from "../budget/types";
import type { ExtractedProduct } from "../validation/schemas";
import type { ExtractionTelemetry, ZodIssueSummary } from "../types";

/** Borne le nombre d'issues journalisées si le provider renvoie un objet massivement invalide. */
const MAX_LOGGED_ZOD_ISSUES = 20;
/** Longueur max d'une valeur `received`/`expected` journalisée (garde-fou, pas une troncature de contenu significatif — ce sont des noms de type ou de courtes valeurs d'enum). */
const MAX_LOGGED_ISSUE_VALUE_LENGTH = 200;

function toSafeIssueString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  const str = String(value);
  return str.length > MAX_LOGGED_ISSUE_VALUE_LENGTH ? `${str.slice(0, MAX_LOGGED_ISSUE_VALUE_LENGTH)}…` : str;
}

/**
 * Ne journalise jamais `issue.input`/la valeur extraite — uniquement la
 * structure de l'échec de validation (chemin, code, type attendu/reçu selon
 * Zod). Seul un enum invalide expose une valeur (`received`), toujours celle
 * du champ précis en échec (ex. `productKind`), jamais du reste de la
 * réponse — voir `ZodIssueSummary`.
 */
function summarizeZodIssues(error: ZodError): ZodIssueSummary[] {
  return error.issues.slice(0, MAX_LOGGED_ZOD_ISSUES).map((issue) => {
    const raw = issue as unknown as { expected?: unknown; received?: unknown };
    return {
      path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
      code: issue.code,
      expected: toSafeIssueString(raw.expected),
      received: toSafeIssueString(raw.received),
      message: issue.message,
    };
  });
}

/** Incrémenté à chaque changement de forme de `TcgCardExtraction` — entre dans la clé de cache. */
export const TCG_CARD_EXTRACTION_SCHEMA_VERSION = 1;

const MAX_ESTIMATE_INPUT_TOKENS = 1200;
const MAX_ESTIMATE_OUTPUT_TOKENS = 300;
const DEFAULT_FIELD_CONFIDENCE = 0.6;

export interface TcgCardExtractionInput {
  /**
   * Identifiant stable de l'image (ex. chemin Storage `<user_id>/<id>/photo.jpg`)
   * — utilisé UNIQUEMENT pour le fingerprint de cache, jamais envoyé au
   * provider. Une URL signée change à chaque génération ; l'utiliser ici
   * romprait le cache à chaque appel (voir `imageUrl` ci-dessous pour l'URL
   * réellement envoyée au provider).
   */
  imageStorageKey: string;
  /** URL réellement envoyée au provider (ex. URL signée Supabase Storage, courte durée de vie) — jamais utilisée comme base du cache. */
  imageUrl: string;
}

export interface ExtractTcgCardOptions {
  provider: AIProvider;
  cache?: ExtractionCache;
  budgetGuard?: BudgetGuard;
}

export type TcgCardExtractionSource = "cache" | "ai";

export interface TcgCardFieldExtraction {
  value: string | null;
  confidence: number;
}

/**
 * Résultat interne de l'extraction — mappé par l'appelant
 * (`apps/workers/src/jobs/process-analysis.ts`) vers `TcgCardExtractedFields`
 * (`@dealradar/contracts`), jamais retourné tel quel à un client.
 */
export interface TcgCardExtraction {
  game: TcgCardFieldExtraction;
  cardName: TcgCardFieldExtraction;
  setName: TcgCardFieldExtraction;
  cardNumber: TcgCardFieldExtraction;
  variant: TcgCardFieldExtraction;
  language: TcgCardFieldExtraction;
  productKind: { value: "raw_card" | "graded_card" | null; confidence: number };
  gradingCompany: TcgCardFieldExtraction;
  grade: TcgCardFieldExtraction;
  /** Confiance globale déclarée par le modèle — jamais recalculée à partir des confiances par champ (évite une double interprétation divergente). */
  overallConfidence: number;
}

export interface TcgCardExtractionResult {
  extraction: TcgCardExtraction;
  source: TcgCardExtractionSource;
  warnings: string[];
  telemetry: ExtractionTelemetry;
}

function emptyExtraction(): TcgCardExtraction {
  return {
    game: { value: null, confidence: 0 },
    cardName: { value: null, confidence: 0 },
    setName: { value: null, confidence: 0 },
    cardNumber: { value: null, confidence: 0 },
    variant: { value: null, confidence: 0 },
    language: { value: null, confidence: 0 },
    productKind: { value: null, confidence: 0 },
    gradingCompany: { value: null, confidence: 0 },
    grade: { value: null, confidence: 0 },
    overallConfidence: 0,
  };
}

function rawToExtraction(raw: RawTcgCardProviderResponse): TcgCardExtraction {
  const confidenceMap = raw.confidence ?? {};
  const conf = (key: string) => confidenceMap[key] ?? DEFAULT_FIELD_CONFIDENCE;
  const field = (value: string | null | undefined, key: string): TcgCardFieldExtraction =>
    value ? { value, confidence: conf(key) } : { value: null, confidence: 0 };

  return {
    game: field(raw.game, "game"),
    cardName: field(raw.cardName, "cardName"),
    setName: field(raw.setName, "setName"),
    cardNumber: field(raw.cardNumber, "cardNumber"),
    variant: field(raw.variant, "variant"),
    language: field(raw.language, "language"),
    productKind: raw.productKind ? { value: raw.productKind, confidence: conf("productKind") } : { value: null, confidence: 0 },
    gradingCompany: field(raw.gradingCompany, "gradingCompany"),
    grade: field(raw.grade, "grade"),
    overallConfidence: raw.overallConfidence ?? 0,
  };
}

/** Sérialise l'extraction dans le sac `attributes` d'`ExtractedProduct` — même table de cache que l'extraction générique (`ai_extraction_cache`), aucune nouvelle table. */
function extractionToCacheProduct(extraction: TcgCardExtraction): ExtractedProduct {
  const attributes: ExtractedProduct["attributes"] = {};
  const put = (key: string, field: TcgCardFieldExtraction | { value: string | null; confidence: number }) => {
    if (field.value !== null) attributes[key] = { value: field.value, confidence: field.confidence, source: "ai" };
  };
  put("cardName", extraction.cardName);
  put("setName", extraction.setName);
  put("cardNumber", extraction.cardNumber);
  put("variant", extraction.variant);
  put("gradingCompany", extraction.gradingCompany);
  put("grade", extraction.grade);
  put("productKind", extraction.productKind);
  attributes.overallConfidence = { value: extraction.overallConfidence, confidence: 1, source: "ai" };

  return {
    brand: null,
    model: null,
    reference: null,
    category: { value: "pokemon_tcg", confidence: 1, source: "ai" },
    subcategory: null,
    condition: null,
    language: extraction.language.value ? { value: extraction.language.value, confidence: extraction.language.confidence, source: "ai" } : null,
    color: null,
    capacity: null,
    accessories: null,
    serialNumberDetected: { value: false, confidence: 0.5, source: "ai" },
    attributes,
  };
}

function cacheProductToExtraction(product: ExtractedProduct): TcgCardExtraction {
  const attrs = product.attributes;
  const str = (key: string): TcgCardFieldExtraction => {
    const entry = attrs[key];
    return entry && typeof entry.value === "string" ? { value: entry.value, confidence: entry.confidence } : { value: null, confidence: 0 };
  };
  const productKindEntry = attrs.productKind;
  const productKindValue = productKindEntry?.value;
  const productKind: { value: "raw_card" | "graded_card" | null; confidence: number } =
    productKindValue === "raw_card" || productKindValue === "graded_card"
      ? { value: productKindValue, confidence: productKindEntry!.confidence }
      : { value: null, confidence: 0 };
  const overallEntry = attrs.overallConfidence;

  return {
    game: str("game"),
    cardName: str("cardName"),
    setName: str("setName"),
    cardNumber: str("cardNumber"),
    variant: str("variant"),
    language: product.language ? { value: product.language.value, confidence: product.language.confidence } : { value: null, confidence: 0 },
    productKind,
    gradingCompany: str("gradingCompany"),
    grade: str("grade"),
    overallConfidence: overallEntry && typeof overallEntry.value === "number" ? overallEntry.value : 0,
  };
}

function buildResult(
  extraction: TcgCardExtraction,
  source: TcgCardExtractionSource,
  warnings: string[],
  startedAt: number,
  extra: Partial<Parameters<typeof buildTelemetry>[0]> = { status: "success" },
): TcgCardExtractionResult {
  return {
    extraction,
    source,
    warnings,
    telemetry: buildTelemetry({ ...extra, status: extra.status ?? "success", latencyMs: Date.now() - startedAt }),
  };
}

/**
 * Extraction visuelle dédiée au scan photo d'une carte TCG (LOT 8) — jamais
 * de déterministe/texte (pas de titre pour une photo), un seul appel
 * provider possible par requête. Réutilise le même `AIProvider`, la même
 * `ExtractionCache` (table `ai_extraction_cache`, LOT 0011/ADR 0009) et le
 * même `BudgetGuard` que `extractProduct()` — pas un second système IA
 * parallèle, seulement un prompt/schéma dédiés à ce cas d'usage.
 */
export async function extractTcgCardFromPhoto(
  input: TcgCardExtractionInput,
  options: ExtractTcgCardOptions,
): Promise<TcgCardExtractionResult> {
  const startedAt = Date.now();
  const { provider } = options;

  const contentFingerprint = createHash("sha256").update(input.imageStorageKey, "utf8").digest("hex");
  const cacheKey = computeCacheKey({
    provider: provider.name,
    model: provider.model,
    promptVersion: TCG_CARD_PROMPT_VERSION,
    schemaVersion: TCG_CARD_EXTRACTION_SCHEMA_VERSION,
    // Aucun extracteur déterministe dans ce flux (photo seule, jamais de texte) — version fixe, jamais incrémentée.
    deterministicExtractorVersion: 0,
    contentFingerprint,
  });

  if (options.cache) {
    const cached = await options.cache.get(cacheKey);
    if (cached) {
      return buildResult(cacheProductToExtraction(cached.product), "cache", [], startedAt, {
        provider: provider.name,
        model: provider.model,
        cacheStatus: "hit",
        status: "success",
      });
    }
  }

  const costEntry = findCostTableEntry(provider.name, provider.model);
  const maxCostEstimate = estimateCostUsd({ inputUnits: MAX_ESTIMATE_INPUT_TOKENS, outputUnits: MAX_ESTIMATE_OUTPUT_TOKENS }, costEntry) ?? 0;

  let reservationId: string | null = null;
  if (options.budgetGuard) {
    const reservation = await options.budgetGuard.reserve(maxCostEstimate);
    if (!reservation) {
      return buildResult(emptyExtraction(), "ai", ["BUDGET_EXCEEDED"], startedAt, {
        provider: provider.name,
        model: provider.model,
        status: "skipped",
        errorCode: "BUDGET_EXCEEDED",
      });
    }
    reservationId = reservation.reservationId;
  }

  const prompt = buildTcgCardPrompt();

  try {
    const response = await provider.extract({ system: prompt.system, userText: prompt.userText, images: [{ url: input.imageUrl }] });
    const estimatedCostUsd = estimateCostUsd(response.usage, costEntry) ?? 0;

    if (reservationId && options.budgetGuard) {
      await options.budgetGuard.finalize(reservationId, {
        status: "completed",
        inputUnits: response.usage.inputUnits,
        outputUnits: response.usage.outputUnits,
        estimatedCostUsd,
      });
    }

    const parsed = rawTcgCardProviderResponseSchema.safeParse(response.raw);
    if (!parsed.success) {
      const invalidIssues = summarizeZodIssues(parsed.error);
      return buildResult(emptyExtraction(), "ai", ["INVALID_PROVIDER_RESPONSE"], startedAt, {
        provider: provider.name,
        model: provider.model,
        cacheStatus: "miss",
        inputUnits: response.usage.inputUnits,
        outputUnits: response.usage.outputUnits,
        imageCount: 1,
        estimatedCostUsd,
        status: "error",
        errorCode: "INVALID_PROVIDER_RESPONSE",
        invalidIssues,
        invalidPaths: invalidIssues.map((issue) => issue.path),
        invalidCodes: invalidIssues.map((issue) => issue.code),
      });
    }

    const extraction = rawToExtraction(parsed.data);

    if (options.cache) {
      await options.cache.set(cacheKey, {
        product: extractionToCacheProduct(extraction),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return buildResult(extraction, "ai", [], startedAt, {
      provider: provider.name,
      model: provider.model,
      cacheStatus: "miss",
      inputUnits: response.usage.inputUnits,
      outputUnits: response.usage.outputUnits,
      imageCount: 1,
      estimatedCostUsd,
      status: "success",
    });
  } catch (error) {
    if (reservationId && options.budgetGuard) {
      await options.budgetGuard.finalize(reservationId, { status: "failed", inputUnits: 0, outputUnits: 0, estimatedCostUsd: 0 });
    }
    // `error.message` est sûr à propager tel quel : `provider/http.ts` et
    // chaque provider concret (`openai.ts`/`claude.ts`) ne composent jamais
    // ce message à partir du corps de la réponse, d'une image ou d'un
    // secret — uniquement un statut HTTP et un libellé générique fixe.
    const providerError = error instanceof ProviderError ? error : null;
    const errorCode = providerError?.code ?? "UNKNOWN";
    return buildResult(emptyExtraction(), "ai", [errorCode === "TIMEOUT" ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR"], startedAt, {
      provider: provider.name,
      model: provider.model,
      cacheStatus: "miss",
      status: "error",
      errorCode,
      errorHttpStatus: providerError?.httpStatus ?? null,
      errorMessage: providerError?.message ?? (error instanceof Error ? error.message : "Erreur inconnue lors de l'appel provider."),
    });
  }
}
