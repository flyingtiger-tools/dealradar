import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketObservation } from "@dealradar/connectors";
import { computeVolatility, computeTrend, type MedianRangeSignal, type HistoricalPricePoint, type TrendSignal, type VolatilitySignal } from "@dealradar/core";

/** Même ordre que `EvidenceQualityTier` (`@dealradar/connectors`) — dupliqué localement plutôt qu'importé d'une constante privée de `fuse-market-observations.ts` (même discipline de découplage que `CostClass`, `packages/core/src/scheduling/snapshot-scheduling-policy.ts`). */
const TIER_ORDER: readonly string[] = ["A", "B", "C", "D", "E"];

function strongestTierOf(observations: readonly MarketObservation[]): string | null {
  for (const tier of TIER_ORDER) {
    if (observations.some((o) => o.evidenceTier === tier)) return tier;
  }
  return null;
}

/**
 * Persistance idempotente d'un résumé compact de cycle (LOT "Close the
 * Refresh Loop", section 10) — `market_snapshot_summaries` (migration
 * 0023). AUCUNE recommandation utilisateur (BUY/PASS/REVIEW) n'est
 * calculée ni persistée ici, exactement comme `takeMarketSnapshot`
 * lui-même (voir son en-tête). `low`/`fair`/`high` proviennent du
 * `MedianRangeSignal` DÉJÀ calculé par `takeMarketSnapshot` (p25/médiane/
 * p75) — jamais recalculés séparément, une seule source de vérité pour
 * cette fourchette.
 *
 * `volatility`/`trends` sont calculés à partir de l'HISTORIQUE PERSISTÉ
 * (`historicalPoints`, fourni par l'appelant — typiquement une lecture de
 * `market_observations` sur une fenêtre de temps, jamais seulement le
 * cycle courant) : un cycle unique ne permet jamais de juger une
 * tendance, voir `computeTrend`/`computeVolatility` (`@dealradar/core`).
 */
export interface PersistMarketSnapshotSummaryInput {
  supabase: SupabaseClient;
  productKey: string;
  asOf: string;
  currency: string;
  normalizedRange: MedianRangeSignal | null;
  observations: readonly MarketObservation[];
  /** Points de prix historiques (incluant potentiellement ce cycle) pour le calcul de volatilité/tendance — fenêtre de lookback à la charge de l'appelant. */
  historicalPoints: readonly HistoricalPricePoint[];
  activeSupplyCount: number;
  coverageScore: number | null;
  fxDiagnostics?: Record<string, unknown> | null;
}

export interface PersistMarketSnapshotSummaryResult {
  cycleKey: string;
  outcome: "inserted" | "updated";
}

export async function persistMarketSnapshotSummary(input: PersistMarketSnapshotSummaryInput): Promise<PersistMarketSnapshotSummaryResult> {
  const cycleKey = `${input.productKey}:${input.asOf}`;

  const { data: existing } = await input.supabase.from("market_snapshot_summaries").select("id").eq("cycle_key", cycleKey).maybeSingle();

  const volatility: VolatilitySignal | null = computeVolatility(input.historicalPoints);
  const trends: Record<string, TrendSignal> = {
    d7: computeTrend(input.historicalPoints, input.asOf, 7),
    d30: computeTrend(input.historicalPoints, input.asOf, 30),
    d90: computeTrend(input.historicalPoints, input.asOf, 90),
  };

  const row = {
    product_key: input.productKey,
    cycle_at: input.asOf,
    cycle_key: cycleKey,
    currency: input.currency,
    low_cents: input.normalizedRange?.p25Cents ?? null,
    fair_cents: input.normalizedRange?.medianCents ?? null,
    high_cents: input.normalizedRange?.p75Cents ?? null,
    confidence: null as number | null, // aucune confiance de fusion calculée par takeMarketSnapshot aujourd'hui — jamais une valeur inventée.
    observation_count: input.observations.length,
    source_count: new Set(input.observations.map((o) => o.source)).size,
    strongest_tier: strongestTierOf(input.observations),
    coverage_score: input.coverageScore,
    active_supply_count: input.activeSupplyCount,
    volatility: volatility as unknown as Record<string, unknown> | null,
    trends: trends as unknown as Record<string, unknown>,
    currencies_observed: [...new Set(input.observations.map((o) => o.currency))],
    fx_diagnostics: input.fxDiagnostics ?? null,
  };

  const { error } = await input.supabase.from("market_snapshot_summaries").upsert(row, { onConflict: "cycle_key" });
  if (error) {
    throw new Error(`Persistance du résumé d'instantané impossible : ${(error as { message?: string }).message ?? "erreur inconnue"}`);
  }

  return { cycleKey, outcome: existing ? "updated" : "inserted" };
}
