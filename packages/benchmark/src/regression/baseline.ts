import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AggregateMetrics, QualityMetrics } from "../types";

/** Tolérance par défaut avant qu'un écart soit considéré comme une régression. */
const DEFAULT_TOLERANCE = 0.05;

export interface BaselineFile {
  categorySlug: string;
  savedAt: string;
  quality: QualityMetrics;
}

export interface RegressionResult {
  categorySlug: string;
  passed: boolean;
  details: string[];
}

/**
 * Extrait les 4 seules métriques de qualité comparées à la baseline.
 * Latence, coût estimé et taux de cache hit ne font jamais partie de cet
 * ensemble — ils dépendent du provider (simulé ou réel) et de
 * l'environnement, pas de la qualité du code (voir docs/benchmark.md).
 */
export function extractQualityMetrics(metrics: AggregateMetrics): QualityMetrics {
  return {
    precisionAnnotee: metrics.precisionAnnotee,
    tauxExtractionInvalide: metrics.rates.invalidExtraction,
    tauxContradictionMajeure: metrics.rates.majorContradiction,
    tauxInsufficientData: metrics.rates.insufficientData,
  };
}

export function loadBaseline(path: string): BaselineFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as BaselineFile;
}

/** Écrase la baseline — geste explicite (`--save-baseline`), jamais automatique. */
export function saveBaseline(path: string, metrics: AggregateMetrics): void {
  mkdirSync(dirname(path), { recursive: true });
  const file: BaselineFile = {
    categorySlug: metrics.categorySlug,
    savedAt: new Date().toISOString(),
    quality: extractQualityMetrics(metrics),
  };
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
}

/**
 * Compare uniquement les 4 métriques de qualité à la baseline. Sans
 * baseline (premier run), retourne toujours `passed: true` — rien à
 * comparer, pas un échec par défaut.
 */
export function compareToBaseline(
  current: AggregateMetrics,
  baseline: BaselineFile | null,
  tolerance: number = DEFAULT_TOLERANCE,
): RegressionResult {
  if (!baseline) {
    return { categorySlug: current.categorySlug, passed: true, details: ["Aucune baseline enregistrée — rien à comparer (premier run)."] };
  }

  const currentQuality = extractQualityMetrics(current);
  const details: string[] = [];
  let passed = true;

  if (currentQuality.precisionAnnotee !== null && baseline.quality.precisionAnnotee !== null) {
    const delta = currentQuality.precisionAnnotee - baseline.quality.precisionAnnotee;
    if (delta < -tolerance) {
      passed = false;
      details.push(`Précision annotée en baisse : ${(baseline.quality.precisionAnnotee * 100).toFixed(1)}% → ${(currentQuality.precisionAnnotee * 100).toFixed(1)}%`);
    }
  }

  const higherIsWorse: Array<{ key: keyof QualityMetrics; label: string }> = [
    { key: "tauxExtractionInvalide", label: "Taux d'extraction invalide" },
    { key: "tauxContradictionMajeure", label: "Taux de contradiction majeure" },
    { key: "tauxInsufficientData", label: "Taux INSUFFICIENT_DATA" },
  ];
  for (const { key, label } of higherIsWorse) {
    const currentValue = currentQuality[key] as number;
    const baselineValue = baseline.quality[key] as number;
    const delta = currentValue - baselineValue;
    if (delta > tolerance) {
      passed = false;
      details.push(`${label} en hausse : ${(baselineValue * 100).toFixed(1)}% → ${(currentValue * 100).toFixed(1)}%`);
    }
  }

  if (details.length === 0) details.push("Aucune régression de qualité détectée.");
  return { categorySlug: current.categorySlug, passed, details };
}
