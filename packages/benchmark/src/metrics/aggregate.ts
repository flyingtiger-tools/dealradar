import type { BenchmarkListingResult, AggregateMetrics } from "../types";

export class MixedProvenanceError extends Error {
  constructor() {
    super(
      "Impossible d'agréger des datasets de provenances différentes (synthetic/real) dans un même calcul — " +
        "voir la décision « synthétique et réel jamais mélangés » du Lot 6.",
    );
    this.name = "MixedProvenanceError";
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function stats(values: number[]): { avg: number; median: number; p95: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { avg: average(values), median: median(sorted), p95: p95(sorted) };
}

function rate(count: number, denominator: number): number {
  return denominator === 0 ? 0 : count / denominator;
}

export interface AggregateInput {
  categorySlug: string;
  provenance: "synthetic" | "real";
  datasetLabel: string;
  results: BenchmarkListingResult[];
}

/**
 * Calcule toutes les métriques d'un seul dataset. Jamais appelé avec des
 * résultats de provenances mélangées : `provenance` est copiée telle quelle
 * depuis le dataset source, jamais déduite d'un mélange.
 */
export function aggregate(input: AggregateInput): AggregateMetrics {
  const { results } = input;
  const usable = results.filter((r) => r.usable);
  const aiPath = usable.filter((r) => r.extractionSource === "ai" || r.extractionSource === "cache");
  const annotated = usable.filter((r) => r.sufficiencyCorrect !== null);
  const problemListings = results
    .filter(
      (r) =>
        !r.usable ||
        r.sufficiencyCorrect === false ||
        r.warnings.some((w) => w.code === "MAJOR_CONTRADICTION" || w.code === "INVALID_PROVIDER_RESPONSE"),
    )
    .map((r) => ({
      itemId: r.itemId,
      reason: !r.usable
        ? "Annonce eBay inutilisable (titre/prix manquant)"
        : r.sufficiencyCorrect === false
          ? "Précision annotée incorrecte (sufficientDeterministic ne correspond pas au résultat)"
          : r.warnings.map((w) => `${w.code}: ${w.message}`).join(" ; "),
    }));

  return {
    categorySlug: input.categorySlug,
    provenance: input.provenance,
    datasetLabel: input.datasetLabel,
    totalListings: results.length,
    usableListings: usable.length,
    rates: {
      cacheHit: rate(aiPath.filter((r) => r.cacheHit).length, aiPath.length),
      deterministicOnly: rate(usable.filter((r) => r.extractionSource === "deterministic").length, usable.length),
      aiCalled: rate(aiPath.length, usable.length),
      majorContradiction: rate(usable.filter((r) => r.warnings.some((w) => w.code === "MAJOR_CONTRADICTION")).length, usable.length),
      invalidExtraction: rate(usable.filter((r) => r.warnings.some((w) => w.code === "INVALID_PROVIDER_RESPONSE")).length, usable.length),
      insufficientData: rate(usable.filter((r) => r.decision === "INSUFFICIENT_DATA").length, usable.length),
    },
    precisionAnnotee: annotated.length === 0 ? null : rate(annotated.filter((r) => r.sufficiencyCorrect === true).length, annotated.length),
    costUsd: {
      total: usable.reduce((sum, r) => sum + r.estimatedCostUsd, 0),
      average: average(usable.map((r) => r.estimatedCostUsd)),
    },
    timingsMs: {
      total: stats(usable.map((r) => r.timings.totalMs)),
      extraction: stats(usable.map((r) => r.timings.extractionMs)),
      cache: stats(usable.map((r) => r.timings.cacheMs)),
      provider: stats(usable.map((r) => r.timings.providerMs)),
      mapping: stats(usable.map((r) => r.timings.mappingMs)),
      intelligence: stats(usable.map((r) => r.timings.intelligenceMs)),
    },
    problemListings,
  };
}

/**
 * Combine plusieurs `AggregateMetrics` de **même provenance** en une ligne
 * de synthèse (ex. toutes les catégories synthétiques confondues). Lève
 * `MixedProvenanceError` si les provenances diffèrent — jamais de mélange
 * silencieux entre synthétique et réel.
 */
export function combineAggregates(metricsList: AggregateMetrics[]): AggregateMetrics {
  if (metricsList.length === 0) {
    throw new Error("Aucun résultat à combiner.");
  }
  const provenance = metricsList[0]!.provenance;
  if (metricsList.some((m) => m.provenance !== provenance)) {
    throw new MixedProvenanceError();
  }

  const totalListings = metricsList.reduce((sum, m) => sum + m.totalListings, 0);
  const usableListings = metricsList.reduce((sum, m) => sum + m.usableListings, 0);
  const weightedRate = (selector: (m: AggregateMetrics) => number) =>
    usableListings === 0 ? 0 : metricsList.reduce((sum, m) => sum + selector(m) * m.usableListings, 0) / usableListings;

  const annotatedTotals = metricsList.filter((m) => m.precisionAnnotee !== null);
  const totalCost = metricsList.reduce((sum, m) => sum + m.costUsd.total, 0);

  const combineTimings = (selector: (m: AggregateMetrics) => { avg: number; median: number; p95: number }) => ({
    avg: weightedRate((m) => selector(m).avg),
    median: average(metricsList.map((m) => selector(m).median)),
    p95: Math.max(0, ...metricsList.map((m) => selector(m).p95)),
  });

  return {
    categorySlug: "all",
    provenance,
    datasetLabel: `Synthèse (${metricsList.map((m) => m.categorySlug).join(", ")})`,
    totalListings,
    usableListings,
    rates: {
      cacheHit: weightedRate((m) => m.rates.cacheHit),
      deterministicOnly: weightedRate((m) => m.rates.deterministicOnly),
      aiCalled: weightedRate((m) => m.rates.aiCalled),
      majorContradiction: weightedRate((m) => m.rates.majorContradiction),
      invalidExtraction: weightedRate((m) => m.rates.invalidExtraction),
      insufficientData: weightedRate((m) => m.rates.insufficientData),
    },
    precisionAnnotee: annotatedTotals.length === 0 ? null : average(annotatedTotals.map((m) => m.precisionAnnotee!)),
    costUsd: { total: totalCost, average: usableListings === 0 ? 0 : totalCost / usableListings },
    timingsMs: {
      total: combineTimings((m) => m.timingsMs.total),
      extraction: combineTimings((m) => m.timingsMs.extraction),
      cache: combineTimings((m) => m.timingsMs.cache),
      provider: combineTimings((m) => m.timingsMs.provider),
      mapping: combineTimings((m) => m.timingsMs.mapping),
      intelligence: combineTimings((m) => m.timingsMs.intelligence),
    },
    problemListings: metricsList.flatMap((m) => m.problemListings),
  };
}
