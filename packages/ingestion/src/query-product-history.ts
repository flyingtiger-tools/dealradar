import type { SupabaseClient } from "@supabase/supabase-js";
import { computeHistoryIntelligenceV2, summarizeObservations, type HistoryIntelligenceV2, type HistoryPointV2 } from "@dealradar/core";
import { queryHistoricalPricePoints } from "./query-historical-price-points";

/**
 * Service de lecture d'historique PAR PRODUIT, en LECTURE SEULE (LOT "Data
 * Quality Calibration + Operator Observability + Mobile Market Insight
 * Contract", section 11) — AUCUNE écriture, AUCUNE recommandation, AUCUNE
 * prédiction de prix futur. Compose des briques déjà pures/testées
 * (`queryHistoricalPricePoints`, `computeHistoryIntelligenceV2`) plutôt que
 * de dupliquer leur logique.
 */
export interface RecentSnapshotSummaryEntry {
  cycleAt: string;
  cycleKey: string;
  currency: string;
  lowCents: number | null;
  fairCents: number | null;
  highCents: number | null;
  confidence: number | null;
  observationCount: number;
  sourceCount: number;
  strongestTier: string | null;
  coverageScore: number | null;
  activeSupplyCount: number;
}

export interface ProductHistoryResult {
  productKey: string;
  asOf: string;
  recentSnapshotSummaries: RecentSnapshotSummaryEntry[];
  /** Intelligence d'historique COMPLÈTE (V2, `@dealradar/core`) — trends 7/30/90/180j, percentile actuel, confiance, volatilité, liquidité (proxy étiqueté). `sampleSize === 0` si aucun point sur la fenêtre demandée, jamais une exception. */
  history: HistoryIntelligenceV2;
  activeSupplyCount: number;
  sourceDiversity: number;
  /** Ancienneté du point le plus récent, en heures — `null` sans aucun point. Exposé séparément de `history` (qui ne le porte pas lui-même) car `toFusionHistoryContext` en a besoin pour construire un `FusionHistoryContext`. */
  freshnessHours: number | null;
}

export interface QueryProductHistoryOptions {
  asOf?: string;
  /** Fenêtre de lookback pour les points de prix bruts, en jours — défaut 180 (couvre la plus longue fenêtre de tendance V2). */
  lookbackDays?: number;
  /** Nombre de résumés de cycle récents à retourner — défaut 12. */
  recentSummaryLimit?: number;
  /** Prix actuel connu (ex. dernier `fairCents` fusionné) pour calculer le percentile/écart vs historique — `null`/absent si inconnu, jamais deviné. */
  currentPriceCents?: number | null;
}

interface RawSnapshotSummaryRow {
  cycle_at: string;
  cycle_key: string;
  currency: string;
  low_cents: number | null;
  fair_cents: number | null;
  high_cents: number | null;
  confidence: number | null;
  observation_count: number;
  source_count: number;
  strongest_tier: string | null;
  coverage_score: number | null;
  active_supply_count: number;
}

interface RawListingLifecycleRow {
  currently_seen: boolean;
}

export async function queryProductHistory(supabase: SupabaseClient, productKey: string, options: QueryProductHistoryOptions = {}): Promise<ProductHistoryResult> {
  const asOf = options.asOf ?? new Date().toISOString();
  const lookbackDays = options.lookbackDays ?? 180;
  const recentSummaryLimit = options.recentSummaryLimit ?? 12;

  const sinceIso = new Date(Date.parse(asOf) - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const pricePoints = await queryHistoricalPricePoints(supabase, productKey, { sinceIso });
  const historyPoints: HistoryPointV2[] = pricePoints.map((p) => ({ observedAt: p.observedAt, priceCents: p.priceCents, source: p.source }));
  const history = computeHistoryIntelligenceV2(historyPoints, asOf, { currentPriceCents: options.currentPriceCents ?? null });
  const freshnessHours = summarizeObservations(historyPoints, asOf).freshnessHours;

  const { data: summaryRows, error: summaryError } = await supabase
    .from("market_snapshot_summaries")
    .select("*")
    .eq("product_key", productKey)
    .order("cycle_at", { ascending: false })
    .limit(recentSummaryLimit);
  if (summaryError) {
    throw new Error(`Lecture des résumés de cycle impossible : ${(summaryError as { message?: string }).message ?? "erreur inconnue"}`);
  }
  const recentSnapshotSummaries = ((summaryRows as RawSnapshotSummaryRow[] | null) ?? []).map(
    (r): RecentSnapshotSummaryEntry => ({
      cycleAt: r.cycle_at,
      cycleKey: r.cycle_key,
      currency: r.currency,
      lowCents: r.low_cents,
      fairCents: r.fair_cents,
      highCents: r.high_cents,
      confidence: r.confidence,
      observationCount: r.observation_count,
      sourceCount: r.source_count,
      strongestTier: r.strongest_tier,
      coverageScore: r.coverage_score,
      activeSupplyCount: r.active_supply_count,
    }),
  );

  const { data: lifecycleRows, error: lifecycleError } = await supabase.from("listing_lifecycles").select("currently_seen").eq("product_key", productKey);
  if (lifecycleError) {
    throw new Error(`Lecture du cycle de vie d'annonces impossible : ${(lifecycleError as { message?: string }).message ?? "erreur inconnue"}`);
  }
  const activeSupplyCount = ((lifecycleRows as RawListingLifecycleRow[] | null) ?? []).filter((r) => r.currently_seen).length;

  return {
    productKey,
    asOf,
    recentSnapshotSummaries,
    history,
    activeSupplyCount,
    sourceDiversity: history.sourceDiversityOverTime,
    freshnessHours,
  };
}
