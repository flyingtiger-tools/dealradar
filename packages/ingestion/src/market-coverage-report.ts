import type { SourceCostClass } from "@dealradar/connectors";
import { costClassForSource } from "@dealradar/connectors";
import type { SourceDiagnostic } from "./aggregate-market-observations";

/**
 * Rapport de couverture d'un cycle d'agrégation multi-source (LOT
 * "Historical Data Engine", section 10) — diagnostics PURS assemblés à
 * partir de ce que `orchestrateMarketIntelligence` (ou le futur moteur
 * d'instantanés, section 5) a déjà calculé pour CE cycle précis. Ne
 * connaît JAMAIS "quelles sources sont éligibles/activées" (ça reste la
 * responsabilité de `resolveSourcesForCategory`/`buildMarketSourcesFromEnv`
 * — deux couches distinctes, jamais fusionnées ici) : ce rapport couvre
 * uniquement les sources RÉELLEMENT interrogées pour ce cycle
 * (`input.sources` déjà résolu par l'appelant).
 *
 * Aucune URL de requête complète ni valeur de credential — uniquement des
 * noms de source, des compteurs et des horodatages.
 */
export interface SourceCoverageEntry {
  source: string;
  status: "success" | "error" | "timeout" | "aborted";
  observationCount: number;
  latencyMs: number;
  costClass: SourceCostClass;
}

export interface MarketCoverageReport {
  categorySlug: string;
  asOf: string;
  sourcesQueried: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  perSource: SourceCoverageEntry[];
  observationsReturned: number;
  /** Après dédoublonnage par origine canonique inter-connecteurs (voir `dedupeByCanonicalOrigin`) — `observationsReturned - observationsAfterCanonicalDedupe` = nombre de doublons inter-sources fusionnés. */
  observationsAfterCanonicalDedupe: number;
  /** Nombre d'observations réellement transmises à la fusion après conversion de devise (celles écartées faute de taux fiable sont exclues). */
  observationsUsableAfterFx: number;
  /** `null` si la persistance n'a pas été tentée. */
  observationsPersisted: number | null;
  /** `null` si aucune source n'a été interrogée. */
  medianLatencyMs: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface BuildMarketCoverageReportInput {
  categorySlug: string;
  asOf: string;
  sourceDiagnostics: readonly SourceDiagnostic[];
  observationsReturned: number;
  observationsAfterCanonicalDedupe: number;
  observationsUsableAfterFx: number;
  observationsPersisted: number | null;
}

export function buildMarketCoverageReport(input: BuildMarketCoverageReportInput): MarketCoverageReport {
  const perSource: SourceCoverageEntry[] = input.sourceDiagnostics.map((d) => ({
    source: d.source,
    status: d.status,
    observationCount: d.observationCount,
    latencyMs: d.latencyMs,
    costClass: costClassForSource(d.source),
  }));

  return {
    categorySlug: input.categorySlug,
    asOf: input.asOf,
    sourcesQueried: perSource.length,
    sourcesSucceeded: perSource.filter((s) => s.status === "success").length,
    sourcesFailed: perSource.filter((s) => s.status !== "success").length,
    perSource,
    observationsReturned: input.observationsReturned,
    observationsAfterCanonicalDedupe: input.observationsAfterCanonicalDedupe,
    observationsUsableAfterFx: input.observationsUsableAfterFx,
    observationsPersisted: input.observationsPersisted,
    medianLatencyMs: median(perSource.map((s) => s.latencyMs)),
  };
}
