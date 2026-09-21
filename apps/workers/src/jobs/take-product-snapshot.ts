import type { SupabaseClient } from "@supabase/supabase-js";
import { KNOWN_SOURCE_QUERY_PROFILES, DEFAULT_REFRESH_BUDGET_LIMITS, initialRefreshBudgetState, type CanonicalProductIdentity, type IdentityHealthSummary, type RefreshBudgetState, type RefreshBudgetLimits } from "@dealradar/core";
import { takeMarketSnapshot, buildSourceSelectionPlan, type MarketSnapshotResult, type SourceSelectionPlan } from "@dealradar/ingestion";
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
}

export interface TakeProductSnapshotOutput {
  snapshot: MarketSnapshotResult;
  selectionPlan: SourceSelectionPlan;
}

export async function takeProductSnapshot(input: TakeProductSnapshotInput): Promise<TakeProductSnapshotOutput> {
  const { sources } = buildMarketSourcesFromEnv();
  const budgetLimits = input.budgetLimits ?? DEFAULT_REFRESH_BUDGET_LIMITS;
  const budgetState = input.budgetState ?? initialRefreshBudgetState(Date.now());

  const selectionPlan = buildSourceSelectionPlan({
    categorySlug: input.categorySlug,
    envPresenceBySource: computeEnvPresenceBySource(),
    identityHealth: input.identityHealth ?? null,
    budgetState,
    budgetLimits,
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
  });

  return { snapshot, selectionPlan };
}
