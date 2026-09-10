import { extractTcgCardFromPhoto, estimateCostUsd, findCostTableEntry, type AIProvider, type TcgCardExtraction } from "@dealradar/ai";
import type { TcgGroundTruth } from "./dataset-schema";
import type { ProviderMatrixEntry, TcgBenchmarkExampleResult, TcgExampleOutcome, TcgFieldName } from "./types";

/** Dupliqué intentionnellement depuis `apps/workers/src/jobs/process-tcg-card-analysis.ts` (MIN_OVERALL_CONFIDENCE) — packages/benchmark ne dépend jamais de apps/workers (mauvais sens de dépendance). Garder synchronisé manuellement si le seuil réel change. */
const MIN_OVERALL_CONFIDENCE = 0.7;

const COMPARED_FIELDS: TcgFieldName[] = ["cardName", "setName", "collectorNumber", "language", "variant"];

/** `collectorNumber` (vocabulaire du dataset, Phase 7) correspond à `cardNumber` côté `TcgCardExtraction` (@dealradar/ai) — seule différence de nom entre les deux vocabulaires, mappée explicitement ici plutôt que devinée. */
function extractionValueFor(extraction: TcgCardExtraction, field: TcgFieldName): string | null {
  if (field === "collectorNumber") return extraction.cardNumber.value;
  return extraction[field].value;
}

/**
 * `extractTcgCardFromPhoto()` collapse déjà `estimateCostUsd(...) ?? 0` en
 * interne (voir `extract-tcg-card.ts`) — impossible de distinguer depuis sa
 * télémétrie seule "coût réellement nul" de "modèle absent de la table
 * tarifaire". Recalcule donc ici indépendamment, à partir de la même table
 * (`COST_TABLE`, `@dealradar/ai`) — jamais une table parallèle, jamais un
 * coût inventé si le modèle n'y figure pas.
 */
function estimateCostForExample(provider: AIProvider, inputUnits: number, outputUnits: number): number | null {
  const entry = findCostTableEntry(provider.name, provider.model);
  return estimateCostUsd({ inputUnits, outputUnits }, entry);
}

function outcomeFromTelemetry(status: string, errorCode?: string): TcgExampleOutcome {
  if (status === "success") return "success";
  if (errorCode === "INVALID_PROVIDER_RESPONSE") return "invalid_schema";
  if (errorCode === "INVALID_RESPONSE") return "invalid_json";
  return "provider_error";
}

export interface RunTcgExampleOptions {
  matrixEntry: ProviderMatrixEntry;
  provider: AIProvider;
  /** URL résolue pour la photo — en mode simulé, jamais réellement déréférencée par le provider (voir `provider/simulated.ts`). */
  imageUrl: string;
  imageStorageKey: string;
}

/**
 * Exécute un seul exemple du dataset TCG à travers `extractTcgCardFromPhoto()`
 * (pipeline réel, inchangé) et compare le résultat à la vérité terrain.
 * Aucun cache, aucun budget guard : chaque exemple est évalué indépendamment
 * pour un relevé honnête, jamais influencé par un appel précédent.
 */
export async function runTcgExample(entry: TcgGroundTruth, options: RunTcgExampleOptions): Promise<TcgBenchmarkExampleResult> {
  const result = await extractTcgCardFromPhoto(
    { imageStorageKey: options.imageStorageKey, imageUrl: options.imageUrl },
    { provider: options.provider },
  );

  const outcome = outcomeFromTelemetry(result.telemetry.status, result.telemetry.errorCode);

  if (outcome !== "success") {
    return {
      exampleId: entry.id,
      tags: entry.tags,
      matrixEntry: options.matrixEntry,
      actualProviderName: options.provider.name,
      outcome,
      fieldMatches: {},
      exactMatch: false,
      overallConfidence: null,
      hallucinated: false,
      needsConfirmation: true,
      inputUnits: result.telemetry.inputUnits,
      outputUnits: result.telemetry.outputUnits,
      estimatedCostUsd: estimateCostForExample(options.provider, result.telemetry.inputUnits, result.telemetry.outputUnits),
      latencyMs: result.telemetry.latencyMs,
    };
  }

  const extraction = result.extraction;
  const fieldMatches: Partial<Record<TcgFieldName, boolean>> = {};
  let hallucinated = false;

  for (const field of COMPARED_FIELDS) {
    const expected = entry[field];
    const actual = extractionValueFor(extraction, field);
    if (expected === null) {
      // Aucune vérité terrain pour ce champ sur cet exemple : non comptabilisé
      // dans l'accuracy (voir TcgFieldAccuracy.evaluable), mais une valeur
      // non nulle inventée par le modèle ici est un signal d'hallucination.
      if (actual !== null) hallucinated = true;
      continue;
    }
    fieldMatches[field] = actual !== null && actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }

  const comparedValues = Object.values(fieldMatches);
  const exactMatch = comparedValues.length > 0 && comparedValues.every(Boolean);

  const hasName = extraction.cardName.value !== null;
  const hasSetOrNumber = extraction.setName.value !== null || extraction.cardNumber.value !== null;
  const needsConfirmation = !(hasName && hasSetOrNumber && extraction.overallConfidence >= MIN_OVERALL_CONFIDENCE);

  return {
    exampleId: entry.id,
    tags: entry.tags,
    matrixEntry: options.matrixEntry,
    actualProviderName: options.provider.name,
    outcome: "success",
    fieldMatches,
    exactMatch,
    overallConfidence: extraction.overallConfidence,
    hallucinated,
    needsConfirmation,
    inputUnits: result.telemetry.inputUnits,
    outputUnits: result.telemetry.outputUnits,
    estimatedCostUsd: estimateCostForExample(options.provider, result.telemetry.inputUnits, result.telemetry.outputUnits),
    latencyMs: result.telemetry.latencyMs,
  };
}
