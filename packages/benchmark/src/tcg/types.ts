import type { TcgDatasetTag } from "./dataset-schema";

/**
 * Une entrée de la matrice provider/modèle à comparer sur le même dataset
 * (Phase 6). `simulated: true` (défaut du CLI) ne fait jamais d'appel
 * réseau réel — voir `provider-matrix.ts`.
 */
export interface ProviderMatrixEntry {
  provider: "openai" | "anthropic" | "groq" | "openrouter";
  model: string;
}

export type TcgFieldName = "cardName" | "setName" | "collectorNumber" | "language" | "variant";

export interface TcgFieldAccuracy {
  field: TcgFieldName;
  /** Nombre d'exemples où le champ attendu n'était pas null (dénominateur de `accuracy`). */
  evaluable: number;
  correct: number;
  /** null si `evaluable === 0` — jamais un taux fabriqué sur zéro exemple évaluable. */
  accuracy: number | null;
}

export type TcgExampleOutcome =
  | "success"
  | "provider_error"
  | "invalid_json"
  | "invalid_schema";

/** Résultat d'un seul exemple du dataset passé à travers `extractTcgCardFromPhoto()` pour une entrée de matrice donnée. */
export interface TcgBenchmarkExampleResult {
  exampleId: string;
  tags: TcgDatasetTag[];
  matrixEntry: ProviderMatrixEntry;
  /** Provider réellement invoqué (toujours "simulated" en mode dry-run — voir `provider-matrix.ts`) — distinct de `matrixEntry`, qui décrit l'intention testée. */
  actualProviderName: string;
  outcome: TcgExampleOutcome;
  /** Comparaison exacte champ par champ (uniquement pour "success") — vide sinon. */
  fieldMatches: Partial<Record<TcgFieldName, boolean>>;
  /** true si TOUS les champs comparables correspondent exactement — jamais partiel. */
  exactMatch: boolean;
  overallConfidence: number | null;
  /**
   * true si le modèle a renvoyé une valeur non nulle pour un champ dont la
   * vérité terrain est explicitement null — signal d'invention, jamais
   * confondu avec une simple erreur de valeur.
   */
  hallucinated: boolean;
  /** Calculé via `isSufficientForAutoCorroboration()` (`@dealradar/ai`) — même fonction, même seuil que le worker réel (`apps/workers/src/jobs/process-tcg-card-analysis.ts`), source de vérité unique. */
  needsConfirmation: boolean;
  inputUnits: number;
  outputUnits: number;
  /** null si le modèle n'a pas d'entrée fiable dans `COST_TABLE` (@dealradar/ai) — jamais un coût inventé. */
  estimatedCostUsd: number | null;
  /** Temps mesuré réellement, mais en mode simulé (`TcgBenchmarkReport.mode === "simulated"`) reflète le délai artificiel de `createSimulatedProvider` (400ms par défaut), jamais une latence provider réelle — ne jamais comparer entre providers tant que `mode !== "live"`. */
  latencyMs: number;
}

export interface TcgMatrixMetrics {
  matrixEntry: ProviderMatrixEntry;
  examplesTotal: number;
  successCount: number;
  providerErrorCount: number;
  invalidJsonCount: number;
  invalidSchemaCount: number;
  /** Sur les succès uniquement — proportion d'exemples où tous les champs comparables correspondent. null si successCount === 0. */
  exactIdentificationAccuracy: number | null;
  fieldAccuracy: TcgFieldAccuracy[];
  /**
   * Écart entre confiance déclarée et exactitude réelle — moyenne de
   * |confidence - (1 si exactMatch sinon 0)| sur les succès. Plus bas =
   * mieux calibré. null si successCount === 0.
   */
  confidenceCalibrationError: number | null;
  needsConfirmationRate: number | null;
  hallucinationRate: number | null;
  /** Voir `TcgBenchmarkExampleResult.latencyMs` — non représentatif de la performance réelle d'un provider tant que `TcgBenchmarkReport.mode !== "live"`. */
  latencyMs: { avg: number; median: number; p95: number };
  inputUnitsTotal: number;
  outputUnitsTotal: number;
  /** Somme des coûts non-null uniquement ; null si AUCUN exemple n'a de coût connu. */
  estimatedCostUsdTotal: number | null;
  /** null si estimatedCostUsdTotal est null OU successCount === 0. */
  costPerSuccessfulIdentificationUsd: number | null;
}

/**
 * Sépare explicitement la réussite déterministe de la contribution IA
 * (philosophie AI-LAST, ADR 0013). Aujourd'hui, aucun extracteur
 * déterministe (OCR/code-barres) n'existe pour une photo de carte TCG —
 * `deterministicSuccessRate` reste donc à 0 par construction, jamais
 * fabriqué : ce champ existe pour que le futur ajout d'un extracteur
 * déterministe (ADR 0013, étape 1) n'exige aucun changement de forme ici.
 */
export interface TcgDeterministicVsAiSummary {
  deterministicSuccessRate: 0;
  aiContributionRate: 1;
  note: string;
}

export interface TcgBenchmarkReport {
  generatedAt: string;
  datasetProvenance: "synthetic" | "real";
  datasetEntryCount: number;
  mode: "simulated" | "live";
  matrices: TcgMatrixMetrics[];
  deterministicVsAi: TcgDeterministicVsAiSummary;
}
