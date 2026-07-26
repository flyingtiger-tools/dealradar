import type { ExtractionSource, ExtractionWarning } from "@dealradar/ai";
import type { Decision } from "@dealradar/core";

export interface PhaseTimings {
  /** Temps de normalisation eBay + construction de l'entrée d'extraction + fusion des attributs. */
  mappingMs: number;
  /** Temps total passé dans `extractProduct()` (déterministe + cache + IA + fusion). */
  extractionMs: number;
  /** Part de `extractionMs` passée dans le cache décoré (get+set), 0 si jamais consulté. */
  cacheMs: number;
  /** Part de `extractionMs` passée dans le provider IA décoré, 0 si jamais appelé. */
  providerMs: number;
  /** Temps passé dans `runIntelligencePipeline()` — pur, en mémoire, jamais de DB dans ce lot. */
  intelligenceMs: number;
  totalMs: number;
}

export interface BenchmarkListingResult {
  itemId: string;
  /** false = item eBay inutilisable (titre/prix manquant) — jamais fabriqué, mêmes règles que normalizeEbayItem réel. */
  usable: boolean;
  extractionSource: ExtractionSource | null;
  cacheHit: boolean;
  warnings: ExtractionWarning[];
  estimatedCostUsd: number;
  decision: Decision | null;
  /** Comparaison à `expected.sufficientDeterministic` du dataset — absent si non annoté. */
  sufficiencyCorrect: boolean | null;
  timings: PhaseTimings;
}

export interface AggregateMetrics {
  categorySlug: string;
  provenance: "synthetic" | "real";
  datasetLabel: string;
  totalListings: number;
  usableListings: number;
  rates: {
    cacheHit: number;
    deterministicOnly: number;
    aiCalled: number;
    majorContradiction: number;
    invalidExtraction: number;
    insufficientData: number;
  };
  /** null si le dataset n'annote aucune entrée — jamais un taux fabriqué sur des données non annotées. */
  precisionAnnotee: number | null;
  costUsd: { total: number; average: number };
  timingsMs: {
    total: { avg: number; median: number; p95: number };
    extraction: { avg: number; median: number; p95: number };
    cache: { avg: number; median: number; p95: number };
    provider: { avg: number; median: number; p95: number };
    mapping: { avg: number; median: number; p95: number };
    intelligence: { avg: number; median: number; p95: number };
  };
  problemListings: Array<{ itemId: string; reason: string }>;
}

/** Les 4 seules métriques comparées à la baseline — jamais latence/coût/cache (voir docs/benchmark.md). */
export interface QualityMetrics {
  precisionAnnotee: number | null;
  tauxExtractionInvalide: number;
  tauxContradictionMajeure: number;
  tauxInsufficientData: number;
}
