import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketSource, FxRateProvider, MarketObservation } from "@dealradar/connectors";
import { resolveFxRates, dedupeByCanonicalOrigin } from "@dealradar/connectors";
import type { CanonicalProductIdentity, QueryPlannerSourceProfile, SearchPlanStep } from "@dealradar/core";
import { buildSearchPlans } from "@dealradar/core";
import { computeMedianRange, type MedianRangeSignal } from "@dealradar/core";
import { aggregateMarketObservations, type SourceDiagnostic } from "./aggregate-market-observations";
import { persistMarketObservations } from "./persist-market-observations";
import { persistFxRate } from "./persist-fx-rate";
import { persistCanonicalProductIdentity } from "./persist-canonical-product-identity";
import { mapMarketObservationsToFusionObservations } from "./map-market-observations-to-fusion";
import { buildMarketCoverageReport, type MarketCoverageReport } from "./market-coverage-report";

/**
 * Moteur d'instantané de marché (LOT "Historical Data Engine", section 5)
 * — job serveur RÉUTILISABLE, séparé de l'analyse interactive
 * (`orchestrateMarketIntelligence`, appelée depuis un scan utilisateur) :
 * DealRadar peut ainsi accumuler de l'historique de marché INDÉPENDAMMENT
 * d'un scan, pour un produit déjà identifié (`CanonicalProductIdentity`).
 *
 * Flux, dans l'ordre : requête PAR PLAN (`buildSearchPlans`, `@dealradar/
 * core` — identifiant d'abord, jamais une requête générée ad hoc) → une
 * source par plan (réutilise `aggregateMarketObservations`, jamais une
 * réimplémentation du bornage de concurrence/délai) → dédoublonnage
 * canonique inter-sources (`dedupeByCanonicalOrigin`) → normalisation FX
 * pour le RÉSUMÉ uniquement (les observations persistées gardent TOUJOURS
 * leur devise d'origine, jamais réécrite) → persistance des observations
 * ET de l'identité canonique (fraîcheur `last_seen_at`) → résumé
 * d'instantané. **AUCUNE décision utilisateur** (BUY/PASS/REVIEW) n'est
 * jamais calculée ici — volontairement absent, voir `orchestrate-market-
 * intelligence.ts` pour ce chemin distinct.
 *
 * Idempotent pour une ré-exécution du même cycle logique : toute
 * persistance (observations, identité, taux FX) repose sur des upserts à
 * contrainte unique déjà en place (voir chaque fonction de persistance),
 * jamais une insertion inconditionnelle.
 */
export interface MarketSnapshotInput {
  identity: CanonicalProductIdentity;
  categorySlug: string;
  desiredCurrency: string;
  sourceProfiles: readonly QueryPlannerSourceProfile[];
  /** Connecteurs RÉELLEMENT disponibles — chaque plan sans connecteur correspondant est simplement ignoré, jamais une erreur. */
  sources: readonly MarketSource[];
  asOf?: string;
  fxRateProvider?: FxRateProvider;
  maxRateAgeHours?: number;
  persistence?: { supabase: SupabaseClient };
}

export interface MarketSnapshotSummary {
  observationCount: number;
  sourceDiversity: number;
  currenciesObserved: string[];
  /** Observations écartées du résumé normalisé faute de TOUT taux disponible (`reasonClass === "missing_rate"`) — jamais silencieusement absorbées (les lignes elles-mêmes restent persistées dans leur devise d'origine). */
  skippedForMissingRateCount: number;
  /** Observations écartées car le taux disponible était PÉRIMÉ (`reasonClass === "stale_rate"`) — distinct de `skippedForMissingRateCount` (LOT "Real DB Integration...", section 5) : un taux existe mais n'est plus fiable, jamais confondu avec une absence totale de taux. */
  staleRateCount: number;
  normalizedCurrency: string;
  normalizedRange: MedianRangeSignal | null;
}

export interface MarketSnapshotResult {
  productKey: string;
  asOf: string;
  searchPlansUsed: SearchPlanStep[];
  coverageReport: MarketCoverageReport;
  /**
   * Observations RÉELLEMENT retenues pour ce cycle (après dédoublonnage
   * canonique inter-sources) — exposées (LOT "Close the Refresh Loop",
   * section 3) pour que l'appelant (le futur exécuteur de rafraîchissement)
   * puisse les réutiliser pour la boucle d'enrichissement d'identité
   * (section 8) et la réconciliation de cycle de vie d'annonces (section 9)
   * SANS ré-interroger les sources une seconde fois.
   */
  observations: readonly MarketObservation[];
  observationsPersisted: number | null;
  persistenceError: string | null;
  identityPersisted: boolean;
  identityPersistenceError: string | null;
  fxRatesPersistedCount: number | null;
  fxPersistenceError: string | null;
  summary: MarketSnapshotSummary;
}

export async function takeMarketSnapshot(input: MarketSnapshotInput): Promise<MarketSnapshotResult> {
  const asOf = input.asOf ?? new Date().toISOString();
  const plans = buildSearchPlans(input.identity, input.sourceProfiles);
  const sourcesByName = new Map(input.sources.map((s) => [s.source, s] as const));

  const perPlanResults = await Promise.all(
    plans.flatMap((plan) => {
      const source = sourcesByName.get(plan.source);
      if (!source) return [];
      return [aggregateMarketObservations({ categorySlug: input.categorySlug, sources: [source], q: plan.q, hints: plan.hints })];
    }),
  );

  const allDiagnostics: SourceDiagnostic[] = perPlanResults.flatMap((r) => r.diagnostics);
  const observationsBeforeCanonicalDedupe = perPlanResults.flatMap((r) => r.observations);
  const { observations, mergedCount: canonicalOriginMergedCount } = dedupeByCanonicalOrigin(observationsBeforeCanonicalDedupe);

  let observationsPersisted: number | null = null;
  let persistenceError: string | null = null;
  if (input.persistence) {
    try {
      const results = await persistMarketObservations(input.persistence.supabase, input.categorySlug, observations);
      observationsPersisted = results.filter((r) => r.outcome !== "refused").length;
    } catch (error) {
      persistenceError = error instanceof Error ? error.message : "Erreur de persistance inconnue.";
    }
  }

  let identityPersisted = false;
  let identityPersistenceError: string | null = null;
  if (input.persistence) {
    try {
      await persistCanonicalProductIdentity(input.persistence.supabase, input.identity);
      identityPersisted = true;
    } catch (error) {
      identityPersistenceError = error instanceof Error ? error.message : "Erreur de persistance d'identité inconnue.";
    }
  }

  // Normalisation FX pour le RÉSUMÉ uniquement — les lignes `market_observations` déjà persistées ci-dessus gardent leur devise d'origine, jamais réécrites.
  const manualRates: Record<string, import("@dealradar/connectors").FxRate> = {};
  let autoResolvedRates = manualRates;
  if (input.fxRateProvider) {
    const foreignCurrencies = [...new Set(observations.map((o) => o.currency).filter((c) => c !== input.desiredCurrency))];
    autoResolvedRates = { ...manualRates, ...(await resolveFxRates(input.fxRateProvider, input.desiredCurrency, foreignCurrencies, asOf.slice(0, 10))) };
  }

  let fxRatesPersistedCount: number | null = null;
  let fxPersistenceError: string | null = null;
  if (input.persistence && Object.keys(autoResolvedRates).length > 0) {
    fxRatesPersistedCount = 0;
    try {
      for (const rate of Object.values(autoResolvedRates)) {
        await persistFxRate(input.persistence.supabase, rate);
        fxRatesPersistedCount += 1;
      }
    } catch (error) {
      fxPersistenceError = error instanceof Error ? error.message : "Erreur de persistance FX inconnue.";
    }
  }

  const { fusionObservations, skipped } = mapMarketObservationsToFusionObservations(observations, {
    targetCurrency: input.desiredCurrency,
    rates: autoResolvedRates,
    maxRateAgeHours: input.maxRateAgeHours ?? 48,
  });
  const normalizedRange = computeMedianRange(fusionObservations.map((o) => ({ observedAt: o.observedAt, priceCents: o.priceCents, source: o.source })));

  const summary: MarketSnapshotSummary = {
    observationCount: observations.length,
    sourceDiversity: new Set(observations.map((o) => o.source)).size,
    currenciesObserved: [...new Set(observations.map((o) => o.currency))],
    skippedForMissingRateCount: skipped.filter((s) => s.reasonClass === "missing_rate").length,
    staleRateCount: skipped.filter((s) => s.reasonClass === "stale_rate").length,
    normalizedCurrency: input.desiredCurrency,
    normalizedRange,
  };

  const coverageReport = buildMarketCoverageReport({
    categorySlug: input.categorySlug,
    asOf,
    sourceDiagnostics: allDiagnostics,
    observationsReturned: observationsBeforeCanonicalDedupe.length,
    observationsAfterCanonicalDedupe: observations.length,
    observationsUsableAfterFx: fusionObservations.length,
    observationsPersisted,
  });
  void canonicalOriginMergedCount; // déjà reflété par observationsReturned vs observationsAfterCanonicalDedupe dans le rapport.

  return {
    productKey: input.identity.productKey,
    asOf,
    searchPlansUsed: plans,
    coverageReport,
    observations,
    observationsPersisted,
    persistenceError,
    identityPersisted,
    identityPersistenceError,
    fxRatesPersistedCount,
    fxPersistenceError,
    summary,
  };
}
