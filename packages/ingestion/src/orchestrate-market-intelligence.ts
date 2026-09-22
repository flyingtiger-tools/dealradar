import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketSource, FxRate, FxRateProvider, SourceCostClass } from "@dealradar/connectors";
import { resolveFxRates, costClassForSource } from "@dealradar/connectors";
import { aggregateMarketObservations, type SourceDiagnostic } from "./aggregate-market-observations";
import { persistMarketObservations } from "./persist-market-observations";
import { persistFxRate } from "./persist-fx-rate";
import { mapMarketObservationsToFusionObservations } from "./map-market-observations-to-fusion";
import { buildMarketCoverageReport, type MarketCoverageReport } from "./market-coverage-report";
import { fuseMarketObservations, type FusedValuation, type FusionTarget, type FusionHistoryContext } from "@dealradar/core";

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
  /** Taux de change PRÉ-FOURNIS pour convertir les observations dans une autre devise que `target.currency` — combinés avec `fxRateProvider` si les deux sont fournis (une entrée explicite ici n'est JAMAIS écrasée par une résolution automatique, voir plus bas). Absent des deux : ces observations seront simplement écartées par `mapMarketObservationsToFusionObservations` (jamais un taux deviné). */
  fxRates?: Record<string, FxRate>;
  /**
   * Fournisseur FX (LOT "Source Wave 3", section 1) — quand fourni, résout
   * automatiquement un taux pour chaque devise étrangère RÉELLEMENT
   * présente parmi les observations agrégées et absente de `fxRates`
   * (voir `resolveFxRates`, `@dealradar/connectors` : direct puis inverse,
   * jamais de triangulation). Idéalement un `FxRateProvider` déjà enveloppé
   * par `createCachedFxRateProvider` pour éviter un appel réseau par
   * analyse — cette fonction ne met rien en cache elle-même.
   */
  fxRateProvider?: FxRateProvider;
  maxRateAgeHours?: number;
  maxConcurrency?: number;
  perSourceTimeoutMs?: number;
  limitPerSource?: number;
  /** Fournie = tentative de persistance ; absente = jamais de tentative (ex. table `market_observations` pas encore migrée en Production, voir la règle ci-dessus). */
  persistence?: { supabase: SupabaseClient };
  /**
   * Contexte d'historique déjà résumé (LOT "Interactive History + Generic
   * Result UI + Full Cancellation + Pre-Prod Activation Package", section
   * 1) — un résumé PUR (médiane/fraîcheur/tendance/confiance/taille
   * d'échantillon), jamais recalculé ici, jamais des points bruts. Absent =
   * comportement IDENTIQUE à avant ce lot (`fuseMarketObservations` sans
   * ancrage d'historique) — voir `toFusionHistoryContext`,
   * `query-product-history.ts` pour la composition typique.
   */
  history?: FusionHistoryContext;
}

/**
 * Diagnostics de change (LOT "Source Wave 3", section 1/9) — jamais une
 * donnée sensible : uniquement des devises, des taux (déjà publics par
 * nature) et des horodatages, jamais une clé/URL de fournisseur.
 */
export interface FxDiagnostics {
  /** Devises RÉELLEMENT observées avant toute conversion (y compris la devise cible elle-même si des observations l'utilisaient déjà). */
  observedCurrencies: string[];
  /** Taux effectivement utilisés pour CETTE analyse (fournis explicitement ou résolus via `fxRateProvider`) — chacun avec sa paire/date/source, jamais une valeur agrégée opaque. */
  ratesUsed: FxRate[];
  /** = `skippedForCurrencyCount` (dupliqué ici pour un accès groupé aux diagnostics de change). */
  skippedForMissingRateCount: number;
}

/**
 * Répartition par TYPE de preuve (LOT "Source Wave 3", section 9) —
 * distincte de la répartition par PALIER déjà exposée par `fused.
 * evidenceMix` : celle-ci reflète honnêtement la NATURE de la preuve
 * (spécialiste calculé/vente confirmée/annonce active/bid-ask/retail),
 * indépendamment du palier de confiance qui lui est attribué.
 */
export interface EvidenceTypeMixEntry {
  evidenceType: string;
  count: number;
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
  /** Nombre de sources DIRECTES (`MarketSource.sourceKind !== "aggregator"`) ayant contribué. */
  directSourceCount: number;
  /** Nombre de sources AGRÉGATRICES (ex. Google Shopping/DataForSEO) ayant contribué — une offre agrégée peut provenir d'un marchand déjà compté ailleurs, voir `merchant` sur `FusionObservation`. */
  aggregatorSourceCount: number;
  /** Répartition par type de preuve brut (voir `EvidenceTypeMixEntry`). */
  evidenceTypeMix: EvidenceTypeMixEntry[];
  /** Classes de coût (voir `costClassForSource`, `@dealradar/connectors`) réellement représentées parmi les sources INTERROGÉES (pas seulement celles qui ont produit une observation) — jamais un montant, juste une classe déclarative. */
  costClassesUsed: SourceCostClass[];
  fx: FxDiagnostics;
  /** Observations écartées avant fusion pour absence de taux de change fiable — jamais silencieusement absorbées dans le compte final. */
  skippedForCurrencyCount: number;
  /** `null` si `persistence` n'a pas été fourni (aucune tentative) — distinct de `0` (tentative faite, 0 ligne insérée/mise à jour). */
  persistedCount: number | null;
  /** `null` si la persistance a réussi ou n'a pas été tentée — jamais levée comme exception (voir l'en-tête du fichier). */
  persistenceError: string | null;
  /** `null` si `persistence` n'a pas été fourni ou qu'aucun taux n'a été utilisé — distinct de `0`. */
  fxRatesPersistedCount: number | null;
  /** `null` si la persistance FX a réussi ou n'a pas été tentée — jamais levée comme exception (même isolation que `persistenceError`). */
  fxPersistenceError: string | null;
  /** Voir `market-coverage-report.ts` — diagnostics de couverture assemblés pour CE cycle précis. */
  coverageReport: MarketCoverageReport;
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

  // Résolution FX automatique (LOT "Source Wave 3", section 1) — une entrée
  // déjà fournie explicitement dans `fxRates` n'est JAMAIS écrasée par une
  // résolution automatique (voir la doc du champ). N'interroge le
  // fournisseur QUE pour les devises réellement présentes parmi les
  // observations agrégées et absentes de `fxRates` — jamais une résolution
  // spéculative pour des devises qui n'apparaissent pas.
  const manualRates = input.fxRates ?? {};
  let autoResolvedRates: Record<string, FxRate> = {};
  if (input.fxRateProvider) {
    const observedForeignCurrencies = [
      ...new Set(aggregated.observations.map((o) => o.currency).filter((c) => c !== input.target.currency && !(c in manualRates))),
    ];
    autoResolvedRates = await resolveFxRates(input.fxRateProvider, input.target.currency, observedForeignCurrencies, input.asOf?.slice(0, 10));
  }
  const allRates: Record<string, FxRate> = { ...autoResolvedRates, ...manualRates };

  // Audit FX (LOT "Source Wave 3" section 1 -> "Historical Data Engine"
  // section 11) — persiste chaque taux EFFECTIVEMENT utilisé pour CETTE
  // analyse via `persistFxRate` (`fx_rates`, déjà générique, aucun
  // couplage à la verticale TCG). Isolée exactement comme la persistance
  // des observations ci-dessus : une panne ne bloque JAMAIS la fusion.
  // Idempotent (contrainte unique sur `fx_rates`, voir `persistFxRate`).
  let fxRatesPersistedCount: number | null = null;
  let fxPersistenceError: string | null = null;
  if (input.persistence && Object.keys(allRates).length > 0) {
    fxRatesPersistedCount = 0;
    try {
      for (const rate of Object.values(allRates)) {
        await persistFxRate(input.persistence.supabase, rate);
        fxRatesPersistedCount += 1;
      }
    } catch (error) {
      fxPersistenceError = error instanceof Error ? error.message : "Erreur de persistance FX inconnue.";
    }
  }

  // Référence temporelle UNIQUE pour cette analyse (trouvaille d'audit
  // beta-readiness, section 12 du LOT "Product History UX...") — AVANT ce
  // correctif, `mapMarketObservationsToFusionObservations` évaluait la
  // péremption des taux FX via l'horloge RÉELLE (`new Date()`) même quand
  // `input.asOf` était fourni, alors que `fuseMarketObservations` juste en
  // dessous utilisait bien `input.asOf` — deux notions de "maintenant"
  // désynchronisées dans le MÊME appel, symptôme réel : un test avec des
  // dates figées (`asOf` + `rateDate` proches) devenait spontanément flaky
  // au fil des jours (le rejet "stale_rate" dépendait de la date réelle
  // d'exécution, jamais de `asOf`). `resolvedAsOf` est calculé UNE SEULE
  // fois et réutilisé pour LES TROIS points de cette fonction qui ont
  // besoin d'une référence temporelle (fusion, péremption FX, et
  // `coverageReport.asOf` plus bas) — jamais une 2e/3e évaluation
  // indépendante de `new Date()`.
  const resolvedAsOf = input.asOf ?? new Date().toISOString();

  const { fusionObservations, skipped } = mapMarketObservationsToFusionObservations(aggregated.observations, {
    targetCurrency: input.target.currency,
    rates: allRates,
    maxRateAgeHours: input.maxRateAgeHours ?? 48,
    now: () => new Date(resolvedAsOf),
  });

  const fused = fuseMarketObservations(fusionObservations, {
    asOf: resolvedAsOf,
    target: input.target,
    ...(input.history ? { history: input.history } : {}),
  });

  // "Live" = état de marché actuel au moment de la requête (annonce active/bid-ask) ;
  // "historical" = point de prix déjà passé/calculé (vente confirmée ou historique
  // spécialiste) — distinction honnête par `evidenceType`, jamais par âge de
  // l'observation (une vente confirmée d'hier reste "historical", jamais "live").
  const liveObservationCount = aggregated.observations.filter((o) => o.evidenceType === "activeListings" || o.evidenceType === "bidAsk").length;
  const historicalObservationCount = aggregated.observations.filter((o) => o.evidenceType === "historicalPrices" || o.evidenceType === "soldTransactions").length;
  const sourceNames = [...new Set(aggregated.observations.map((o) => o.source))];

  const contributingSources = new Map(input.sources.map((s) => [s.source, s] as const));
  let directSourceCount = 0;
  let aggregatorSourceCount = 0;
  for (const name of sourceNames) {
    const source = contributingSources.get(name);
    if (source?.sourceKind === "aggregator") aggregatorSourceCount += 1;
    else directSourceCount += 1;
  }

  const evidenceTypeCounts = new Map<string, number>();
  for (const o of aggregated.observations) evidenceTypeCounts.set(o.evidenceType, (evidenceTypeCounts.get(o.evidenceType) ?? 0) + 1);
  const evidenceTypeMix: EvidenceTypeMixEntry[] = [...evidenceTypeCounts.entries()].map(([evidenceType, count]) => ({ evidenceType, count }));

  const costClassesUsed = [...new Set(input.sources.map((s) => costClassForSource(s.source)))];

  const fx: FxDiagnostics = {
    observedCurrencies: [...new Set(aggregated.observations.map((o) => o.currency))],
    ratesUsed: Object.values(allRates),
    skippedForMissingRateCount: skipped.length,
  };

  return {
    sourceDiagnostics: aggregated.diagnostics,
    observationCount: aggregated.observations.length,
    liveObservationCount,
    historicalObservationCount,
    sourceNames,
    directSourceCount,
    aggregatorSourceCount,
    evidenceTypeMix,
    costClassesUsed,
    fx,
    skippedForCurrencyCount: skipped.length,
    persistedCount,
    persistenceError,
    fxRatesPersistedCount,
    fxPersistenceError,
    coverageReport: buildMarketCoverageReport({
      categorySlug: input.categorySlug,
      // `resolvedAsOf`, jamais une 2e évaluation indépendante de `new
      // Date()` (trouvaille d'audit beta-readiness, section 12 — ce même
      // fichier avait déjà ce bug pour la fusion/le FX, corrigé plus haut ;
      // ce 3e site l'avait reproduit malgré le commentaire affirmant "une
      // seule fois, réutilisé pour les deux appels ci-dessous").
      asOf: resolvedAsOf,
      sourceDiagnostics: aggregated.diagnostics,
      observationsReturned: aggregated.observations.length + aggregated.canonicalOriginMergedCount,
      observationsAfterCanonicalDedupe: aggregated.observations.length,
      observationsUsableAfterFx: fusionObservations.length,
      observationsPersisted: persistedCount,
    }),
    fused,
  };
}
