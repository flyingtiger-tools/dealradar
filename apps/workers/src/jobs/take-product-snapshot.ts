import type { SupabaseClient } from "@supabase/supabase-js";
import { KNOWN_SOURCE_QUERY_PROFILES, DEFAULT_REFRESH_BUDGET_LIMITS, initialRefreshBudgetState, type CanonicalProductIdentity, type IdentityHealthSummary, type RefreshBudgetState, type RefreshBudgetLimits } from "@dealradar/core";
import {
  takeMarketSnapshot,
  buildSourceSelectionPlan,
  loadSourceHealthStates,
  updateSourceHealthFromDiagnostics,
  persistSourceHealthState,
  toHealthLevels,
  type MarketSnapshotResult,
  type SourceSelectionPlan,
} from "@dealradar/ingestion";
import { buildMarketSourcesFromEnv, computeEnvPresenceBySource } from "../ingestion/market-source-factory";
import { sharedFxRateProvider } from "../ingestion/fx-provider";
import { logger } from "../logger";

/**
 * Job d'instantané de marché CALLABLE (LOT "Historical Data Engine",
 * section 14 ; sélection de sources rendue EXACTE au LOT "Real DB
 * Integration + Exact Budget Enforcement + Runtime Observability",
 * sections 3/4) — expose `takeMarketSnapshot` (`@dealradar/ingestion`)
 * câblé avec les sources RÉELLES de l'environnement workers
 * (`buildMarketSourcesFromEnv`) et un `SourceSelectionPlan` EXPLICITE
 * (`buildSourceSelectionPlan`) : la sélection (politique, crédentials,
 * identité, budget) est décidée AVANT toute requête réseau, jamais
 * approximée après coup. Fonction APPELABLE directement (ex. par
 * `process-analysis.ts` en repli, ou le runner de rafraîchissement) — n'installe
 * AUCUN scheduler/cron elle-même (interdiction explicite du lot), ne
 * requiert PAS Railway en ligne pour être testée (tests avec mocks
 * uniquement, aucun appel réseau).
 *
 * `budgetState`/`budgetLimits` sont optionnels — un appelant qui n'a pas
 * de budget multi-cibles à suivre (ex. un appel interactif ponctuel) reçoit
 * un budget à cible unique par défaut (`DEFAULT_REFRESH_BUDGET_LIMITS`),
 * garantissant que le MÊME plan de sélection s'applique aux deux chemins
 * consommateurs (interactif ET rafraîchissement en arrière-plan) — aucune
 * différence cachée entre eux, exigence explicite du lot.
 */
export interface TakeProductSnapshotInput {
  identity: CanonicalProductIdentity;
  categorySlug: string;
  desiredCurrency: string;
  db: SupabaseClient;
  /** `null`/absent = identité pas encore assez connue pour juger l'exactitude par source — aucune source n'est alors exclue pour ce motif. */
  identityHealth?: IdentityHealthSummary | null;
  budgetState?: RefreshBudgetState;
  budgetLimits?: RefreshBudgetLimits;
  /** Signal d'annulation coopérative EXTERNE optionnel (LOT "Interactive History + Generic Result UI + Full Cancellation + Pre-Prod Activation Package", section 7) — voir `runDueMarketRefreshBatch` pour la source (déadline de run). Absent = comportement identique à avant ce lot. */
  signal?: AbortSignal;
}

export interface TakeProductSnapshotOutput {
  snapshot: MarketSnapshotResult;
  selectionPlan: SourceSelectionPlan;
}

export async function takeProductSnapshot(input: TakeProductSnapshotInput): Promise<TakeProductSnapshotOutput> {
  const { sources } = buildMarketSourcesFromEnv();
  const budgetLimits = input.budgetLimits ?? DEFAULT_REFRESH_BUDGET_LIMITS;
  const budgetState = input.budgetState ?? initialRefreshBudgetState(Date.now());

  // Santé PAR SOURCE (LOT "Product History UX + Source Health +
  // Interactive Cancellation + Beta Readiness", section 4/5) — lecture
  // ISOLÉE : une panne/table absente ne bloque JAMAIS la sélection, chaque
  // source retombe simplement sur "healthy" (comportement identique à
  // avant que la santé n'existe).
  let sourceHealthStates: Awaited<ReturnType<typeof loadSourceHealthStates>> = {};
  try {
    sourceHealthStates = await loadSourceHealthStates(input.db, sources.map((s) => s.source));
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Lecture de l'état de santé des sources impossible — sélection sans signal de santé");
  }

  const selectionPlan = buildSourceSelectionPlan({
    categorySlug: input.categorySlug,
    envPresenceBySource: computeEnvPresenceBySource(),
    identityHealth: input.identityHealth ?? null,
    budgetState,
    budgetLimits,
    sourceHealth: toHealthLevels(sourceHealthStates),
  });

  const bySourceName = new Map(sources.map((s) => [s.source, s] as const));
  const resolvedSources = selectionPlan.selectedSources.flatMap((name) => {
    const source = bySourceName.get(name);
    return source ? [source] : []; // sélectionné par le plan mais non construit (ex. incohérence transitoire) -> jamais un crash, simplement ignoré.
  });

  if (resolvedSources.length === 0) {
    logger.info({ productKey: input.identity.productKey, categorySlug: input.categorySlug }, "Instantané de marché : aucune source disponible (credentials absentes, politique, budget, ou catégorie non couverte)");
  }

  const snapshot = await takeMarketSnapshot({
    identity: input.identity,
    categorySlug: input.categorySlug,
    desiredCurrency: input.desiredCurrency,
    sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
    sources: resolvedSources,
    fxRateProvider: sharedFxRateProvider,
    persistence: { supabase: input.db },
    signal: input.signal,
  });

  // Mise à jour de santé ISOLÉE — jamais bloquante pour le résultat déjà
  // calculé ci-dessus (même discipline que la persistance d'observations/
  // d'identité/FX, `take-market-snapshot.ts`). `coverageReport.perSource`
  // porte déjà `status` (y compris `"aborted"`, section 7/8 du lot
  // précédent) — jamais recalculé ici.
  try {
    const asOf = snapshot.asOf;
    const updated = updateSourceHealthFromDiagnostics(sourceHealthStates, snapshot.coverageReport.perSource, asOf);
    for (const name of resolvedSources.map((s) => s.source)) {
      const state = updated[name];
      if (state) await persistSourceHealthState(input.db, state);
    }
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : "erreur inconnue" }, "Mise à jour de l'état de santé des sources impossible — instantané non affecté");
  }

  return { snapshot, selectionPlan };
}
