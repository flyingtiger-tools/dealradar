import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketSource, FxRate } from "@dealradar/connectors";
import { aggregateMarketObservations, type SourceDiagnostic } from "./aggregate-market-observations";
import { persistMarketObservations } from "./persist-market-observations";
import { mapMarketObservationsToFusionObservations } from "./map-market-observations-to-fusion";
import { fuseMarketObservations, type FusedValuation, type FusionTarget } from "@dealradar/core";

/**
 * Chaîne complète agrégation -> persistance (isolée) -> conversion de
 * devise -> fusion (LOT "Source Wave 2", section 6) — point d'entrée
 * unique que `apps/workers` doit appeler pour le chemin générique
 * (non-TCG), jamais une réimplémentation partielle ailleurs.
 *
 * Règle absolue (section 6 du lot) : une panne de PERSISTANCE (ex. la
 * migration 0018 n'est pas encore appliquée) ne doit JAMAIS empêcher le
 * calcul de la valorisation — elle est isolée ici (jamais renvoyée comme
 * exception) et seulement rapportée dans `persistenceError` pour
 * diagnostic. Une panne d'UNE source (`aggregateMarketObservations`) ne
 * bloque jamais les autres (déjà garanti par cette fonction, voir son
 * en-tête).
 */
export interface OrchestrateMarketIntelligenceInput {
  categorySlug: string;
  q: string;
  hints?: Record<string, unknown>;
  country?: string;
  sources: readonly MarketSource[];
  /** Devise cible + contraintes de variante pour la fusion (voir `FusionTarget`, `@dealradar/core`). */
  target: FusionTarget;
  asOf?: string;
  /** Taux de change disponibles pour convertir les observations dans une autre devise que `target.currency` — absent = aucune conversion, ces observations seront simplement écartées par `mapMarketObservationsToFusionObservations` (jamais un taux deviné). */
  fxRates?: Record<string, FxRate>;
  maxRateAgeHours?: number;
  maxConcurrency?: number;
  perSourceTimeoutMs?: number;
  limitPerSource?: number;
  /** Fournie = tentative de persistance ; absente = jamais de tentative (ex. table `market_observations` pas encore migrée en Production, voir la règle ci-dessus). */
  persistence?: { supabase: SupabaseClient };
}

export interface OrchestrateMarketIntelligenceResult {
  sourceDiagnostics: SourceDiagnostic[];
  observationCount: number;
  /** Annonces actives/bid-ask (état de marché courant) — voir la note dans `orchestrateMarketIntelligence`. */
  liveObservationCount: number;
  /** Ventes confirmées/historique spécialiste. */
  historicalObservationCount: number;
  /** Noms de connecteur distincts ayant réellement fourni au moins une observation — jamais une valeur de credential. */
  sourceNames: string[];
  /** Observations écartées avant fusion pour absence de taux de change fiable — jamais silencieusement absorbées dans le compte final. */
  skippedForCurrencyCount: number;
  /** `null` si `persistence` n'a pas été fourni (aucune tentative) — distinct de `0` (tentative faite, 0 ligne insérée/mise à jour). */
  persistedCount: number | null;
  /** `null` si la persistance a réussi ou n'a pas été tentée — jamais levée comme exception (voir l'en-tête du fichier). */
  persistenceError: string | null;
  fused: FusedValuation;
}

export async function orchestrateMarketIntelligence(input: OrchestrateMarketIntelligenceInput): Promise<OrchestrateMarketIntelligenceResult> {
  const aggregated = await aggregateMarketObservations({
    categorySlug: input.categorySlug,
    sources: input.sources,
    q: input.q,
    hints: input.hints,
    country: input.country,
    maxConcurrency: input.maxConcurrency,
    perSourceTimeoutMs: input.perSourceTimeoutMs,
    limitPerSource: input.limitPerSource,
  });

  let persistedCount: number | null = null;
  let persistenceError: string | null = null;
  if (input.persistence) {
    try {
      const results = await persistMarketObservations(input.persistence.supabase, input.categorySlug, aggregated.observations);
      persistedCount = results.filter((r) => r.outcome !== "refused").length;
    } catch (error) {
      // Isolée volontairement — jamais renvoyée comme exception (voir l'en-tête du fichier).
      persistenceError = error instanceof Error ? error.message : "Erreur de persistance inconnue.";
    }
  }

  const { fusionObservations, skipped } = mapMarketObservationsToFusionObservations(aggregated.observations, {
    targetCurrency: input.target.currency,
    rates: input.fxRates ?? {},
    maxRateAgeHours: input.maxRateAgeHours ?? 48,
  });

  const fused = fuseMarketObservations(fusionObservations, {
    asOf: input.asOf ?? new Date().toISOString(),
    target: input.target,
  });

  // "Live" = état de marché actuel au moment de la requête (annonce active/bid-ask) ;
  // "historical" = point de prix déjà passé/calculé (vente confirmée ou historique
  // spécialiste) — distinction honnête par `evidenceType`, jamais par âge de
  // l'observation (une vente confirmée d'hier reste "historical", jamais "live").
  const liveObservationCount = aggregated.observations.filter((o) => o.evidenceType === "activeListings" || o.evidenceType === "bidAsk").length;
  const historicalObservationCount = aggregated.observations.filter((o) => o.evidenceType === "historicalPrices" || o.evidenceType === "soldTransactions").length;
  const sourceNames = [...new Set(aggregated.observations.map((o) => o.source))];

  return {
    sourceDiagnostics: aggregated.diagnostics,
    observationCount: aggregated.observations.length,
    liveObservationCount,
    historicalObservationCount,
    sourceNames,
    skippedForCurrencyCount: skipped.length,
    persistedCount,
    persistenceError,
    fused,
  };
}
