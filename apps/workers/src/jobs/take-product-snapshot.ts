import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSourcesForCategory, type SourceCostClass } from "@dealradar/connectors";
import { KNOWN_SOURCE_QUERY_PROFILES, type CanonicalProductIdentity } from "@dealradar/core";
import { takeMarketSnapshot, type MarketSnapshotResult } from "@dealradar/ingestion";
import { buildMarketSourcesFromEnv } from "../ingestion/market-source-factory";
import { sharedFxRateProvider } from "../ingestion/fx-provider";
import { logger } from "../logger";

/**
 * Job d'instantané de marché CALLABLE (LOT "Historical Data Engine",
 * section 14) — expose `takeMarketSnapshot` (`@dealradar/ingestion`)
 * câblé avec les sources RÉELLES de l'environnement workers
 * (`buildMarketSourcesFromEnv`) et le routage par catégorie existant
 * (`resolveSourcesForCategory`). Fonction APPELABLE directement (ex. par
 * `process-analysis.ts` en repli, ou par un futur job planifié) — n'installe
 * AUCUN scheduler/cron elle-même (interdiction explicite du lot), ne
 * requiert PAS Railway en ligne pour être testée (tests avec mocks
 * uniquement, aucun appel réseau).
 *
 * Séparée du chemin d'analyse interactif (`process-analysis.ts`) : permet
 * à DealRadar de construire de l'historique de marché INDÉPENDAMMENT d'un
 * scan utilisateur (ex. un futur job planifié qui rafraîchit les cibles de
 * `research_targets` dues — jamais déployé par ce lot).
 */
export interface TakeProductSnapshotInput {
  identity: CanonicalProductIdentity;
  categorySlug: string;
  desiredCurrency: string;
  db: SupabaseClient;
  maxCostClass?: SourceCostClass;
  maxSourceCount?: number;
}

export async function takeProductSnapshot(input: TakeProductSnapshotInput): Promise<MarketSnapshotResult> {
  const { sources } = buildMarketSourcesFromEnv();
  const resolvedSources = resolveSourcesForCategory(input.categorySlug, sources, {
    maxCostClass: input.maxCostClass,
    maxSourceCount: input.maxSourceCount,
  });

  if (resolvedSources.length === 0) {
    logger.info({ productKey: input.identity.productKey, categorySlug: input.categorySlug }, "Instantané de marché : aucune source disponible (credentials absentes ou catégorie non couverte)");
  }

  return takeMarketSnapshot({
    identity: input.identity,
    categorySlug: input.categorySlug,
    desiredCurrency: input.desiredCurrency,
    sourceProfiles: KNOWN_SOURCE_QUERY_PROFILES,
    sources: resolvedSources,
    fxRateProvider: sharedFxRateProvider,
    persistence: { supabase: input.db },
  });
}
