import { extractTcgCardFromPhoto, estimateCostUsd, findCostTableEntry, isSufficientForAutoCorroboration, type AIProvider, type TcgCardExtraction } from "@dealradar/ai";
import { collectorNumbersMatch } from "@dealradar/connectors";
import type { TcgGroundTruth } from "./dataset-schema";
import type { ProviderMatrixEntry, TcgBenchmarkExampleResult, TcgExampleOutcome, TcgFieldName } from "./types";

const COMPARED_FIELDS: TcgFieldName[] = ["cardName", "setName", "collectorNumber", "language", "variant"];

/** Champs de vérité terrain non couverts par l'accuracy (`COMPARED_FIELDS`, liste demandée explicitement) mais quand même vérifiés pour l'hallucination — un modèle qui invente une gradation sur une carte brute est un signal réel, pas moins qu'un nom de set inventé. */
const HALLUCINATION_ONLY_FIELDS = ["productKind", "gradingCompany", "grade"] as const;

/** `collectorNumber` (vocabulaire du dataset, Phase 7) correspond à `cardNumber` côté `TcgCardExtraction` (@dealradar/ai) — seule différence de nom entre les deux vocabulaires, mappée explicitement ici plutôt que devinée. */
function extractionValueFor(extraction: TcgCardExtraction, field: TcgFieldName): string | null {
  if (field === "collectorNumber") return extraction.cardNumber.value;
  return extraction[field].value;
}

/**
 * Compare une valeur extraite à la vérité terrain. `collectorNumber` réutilise
 * `collectorNumbersMatch()` (`@dealradar/connectors`, déjà éprouvée en
 * production — voir `corroborate-catalog-identity.ts`) : une comparaison
 * texte brute classerait à tort "96" vs "096" comme un échec, exactement le
 * bug historique que ce projet a corrigé ailleurs. Les autres champs restent
 * une comparaison texte (trim + casse) — aucune normalisation de padding n'a
 * de sens pour un nom de carte/set/langue/variante.
 */
function fieldMatches(field: TcgFieldName, actual: string | null, expected: string): boolean {
  if (field === "collectorNumber") return collectorNumbersMatch(actual, expected);
  return actual !== null && actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

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
  const matches: Partial<Record<TcgFieldName, boolean>> = {};
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
    matches[field] = fieldMatches(field, actual, expected);
  }

  // Hallucination sur les champs de gradation — hors accuracy (non demandés
  // dans la liste explicite des 5 champs mesurés) mais un modèle qui invente
  // `gradingCompany`/`grade` sur une carte brute (vérité terrain null) reste
  // une hallucination réelle, jamais ignorée silencieusement.
  for (const field of HALLUCINATION_ONLY_FIELDS) {
    if (entry[field] === null && extraction[field].value !== null) hallucinated = true;
  }

  const comparedValues = Object.values(matches);
  const exactMatch = comparedValues.length > 0 && comparedValues.every(Boolean);
  const needsConfirmation = !isSufficientForAutoCorroboration(extraction);

  return {
    exampleId: entry.id,
    tags: entry.tags,
    matrixEntry: options.matrixEntry,
    actualProviderName: options.provider.name,
    outcome: "success",
    fieldMatches: matches,
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
