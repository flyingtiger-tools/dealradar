import type { SupabaseClient } from "@supabase/supabase-js";
import {
  summarizeIdentityHealth,
  stripConflictedFields,
  KNOWN_SOURCE_QUERY_PROFILES,
  decideNextSnapshotRefresh,
  decideRefreshRetry,
  initialRefreshBudgetState,
  canProcessAnotherTarget,
  recordTargetStarted,
  recordSourceQueried,
  DEFAULT_REFRESH_BUDGET_LIMITS,
  computeVolatility,
  type CostClass,
  type RefreshFailureReason,
  type RefreshBudgetLimits,
  type RefreshBudgetState,
} from "@dealradar/core";
import {
  queryDueResearchTargets,
  claimResearchTargets,
  releaseResearchTarget,
  loadCanonicalProductIdentity,
  enrichIdentityFromObservations,
  persistCanonicalProductIdentity,
  reconcileAndPersistListingLifecycles,
  persistMarketSnapshotSummary,
  queryHistoricalPricePoints,
  type ResearchTargetRow,
} from "@dealradar/ingestion";
import { takeProductSnapshot } from "./take-product-snapshot";
import { logger } from "../logger";

/**
 * Exécuteur de rafraîchissement des cibles de recherche dues (LOT "Close
 * the Refresh Loop + Operational Hardening + Activation Harness",
 * sections 3/14) — POINT D'ENTRÉE unique qu'un futur scheduler Production
 * (jamais déployé par ce lot, interdiction explicite section 14) pourra
 * invoquer : `runDueMarketRefreshBatch()`. Travail BORNÉ (garde-fous
 * budgétaires, section 5), résumé DÉTERMINISTE, sûr en cas d'invocation
 * concurrente (deux instances workers) grâce au bail atomique
 * `claim_research_target`/`release_research_target` (migration 0021,
 * `packages/ingestion`, section 2).
 *
 * Flux par cible réclamée (section 3) : charger l'identité canonique
 * persistée → construire un plan de requête SÛR (`stripConflictedFields`,
 * jamais une requête exacte sur un champ contesté, section 7) → instantané
 * de marché conscient de la préparation live (`takeProductSnapshot`,
 * lui-même désormais conscient de la matrice de préparation, section 6) →
 * enrichissement d'identité par rétroaction (section 8) → réconciliation
 * du cycle de vie des annonces (section 9) → résumé de cycle compact
 * (section 10) → décision de replanification RÉELLE (succès :
 * `decideNextSnapshotRefresh` ; échec : `decideRefreshRetry`, section 4) →
 * mise à jour de la cible → libération du bail. Une défaillance sur UNE
 * cible n'interrompt jamais le reste du lot (isolation explicite, section 3).
 *
 * LIMITE CONNUE (documentée honnêtement, jamais dissimulée) : les
 * garde-fous budgétaires (section 5) sont appliqués au niveau
 * "classe de coût maximale autorisée pour CETTE cible" via les options déjà
 * exposées par `takeProductSnapshot` (`maxCostClass`/`maxSourceCount`),
 * jamais au niveau de CHAQUE appel réseau individuel (le moteur
 * d'instantané sous-jacent interroge déjà ses sources en parallèle, sans
 * point d'accroche par appel). Le compteur RUN-WIDE (`highCostSourcesQueriedThisRun`)
 * est mis à jour de façon fiable APRÈS COUP à partir de
 * `coverageReport.perSource` (les sources RÉELLEMENT interrogées), donc
 * l'accounting inter-cibles reste exact même si le plafond PAR CIBLE de
 * sources payantes n'est qu'approximatif (voir BUILDER HANDOFF).
 */
export interface RunDueMarketRefreshBatchOptions {
  db: SupabaseClient;
  /** Identifiant libre de CETTE instance workers — jamais un secret (voir migration 0021). */
  leaseOwner: string;
  leaseDurationSeconds?: number;
  limits?: RefreshBudgetLimits;
  /** Heures sans être revue avant qu'une annonce active soit marquée disparue (section 9) — jamais déduit d'un seul cycle manqué. */
  disappearanceRuleHours?: number;
  /** Fenêtre de lookback (jours) pour la volatilité/tendance du résumé de cycle (section 10) — un seul cycle ne permet jamais de juger une tendance. */
  historicalLookbackDays?: number;
  /** Horloge injectable pour les tests — par défaut `() => new Date()`. */
  now?: () => Date;
}

export interface PerTargetRefreshOutcome {
  productKey: string;
  outcome: "succeeded" | "failed";
  failureReason?: RefreshFailureReason;
  observationsPersisted: number;
  nextRefreshAt: string;
  priority: number;
}

export interface RunDueMarketRefreshBatchSummary {
  considered: number;
  claimed: number;
  skippedLocked: number;
  succeeded: number;
  failed: number;
  rescheduled: number;
  observationsPersisted: number;
  /** Compte d'observations agrégé PAR SOURCE, sur l'ensemble du run — jamais une URL/valeur de credential, uniquement des noms et des compteurs. */
  bySourceCoverage: Record<string, number>;
  elapsedMs: number;
  perTarget: PerTargetRefreshOutcome[];
}

const DEFAULT_LEASE_DURATION_SECONDS = 600;
const DEFAULT_DISAPPEARANCE_RULE_HOURS = 72;
const DEFAULT_HISTORICAL_LOOKBACK_DAYS = 90;
/** Borne large pour la PRÉVISUALISATION "due" (`considered`) — volontairement PAS `limits.maxTargetsPerRun` : "considered" doit refléter l'éligibilité réelle, jamais être plafonné par le budget de traitement du run (sinon "skippedLocked" perdrait tout son sens diagnostique, voir section 3). */
const CONSIDERED_PREVIEW_LIMIT = 1000;

function highestCostClassQueried(perSource: readonly { costClass: CostClass }[]): CostClass {
  const order: CostClass[] = ["high_cost", "paid", "cheap", "free"];
  for (const costClass of order) {
    if (perSource.some((s) => s.costClass === costClass)) return costClass;
  }
  return "free";
}

export async function runDueMarketRefreshBatch(options: RunDueMarketRefreshBatchOptions): Promise<RunDueMarketRefreshBatchSummary> {
  const startedAtMs = (options.now?.() ?? new Date()).getTime();
  const limits = options.limits ?? DEFAULT_REFRESH_BUDGET_LIMITS;
  const leaseDurationSeconds = options.leaseDurationSeconds ?? DEFAULT_LEASE_DURATION_SECONDS;
  const disappearanceRuleHours = options.disappearanceRuleHours ?? DEFAULT_DISAPPEARANCE_RULE_HOURS;
  const historicalLookbackDays = options.historicalLookbackDays ?? DEFAULT_HISTORICAL_LOOKBACK_DAYS;

  const dueAtStart = await queryDueResearchTargets(options.db, { limit: CONSIDERED_PREVIEW_LIMIT, now: new Date(startedAtMs) });
  const considered = dueAtStart.length;

  let budgetState: RefreshBudgetState = initialRefreshBudgetState(startedAtMs);
  const perTarget: PerTargetRefreshOutcome[] = [];
  const bySourceCoverage: Record<string, number> = {};
  let claimedCount = 0;
  let succeeded = 0;
  let failed = 0;
  let observationsPersistedTotal = 0;

  for (;;) {
    const nowMs = (options.now?.() ?? new Date()).getTime();
    const budgetCheck = canProcessAnotherTarget(budgetState, limits, nowMs);
    if (!budgetCheck.allowed) break;

    const claimed = await claimResearchTargets(options.db, { leaseOwner: options.leaseOwner, leaseDurationSeconds, limit: 1 });
    const target = claimed[0];
    if (!target) break; // plus aucune cible due/réclamable — jamais une boucle infinie.

    claimedCount += 1;
    budgetState = recordTargetStarted(budgetState);

    try {
      const result = await refreshOneTarget({
        db: options.db,
        target,
        asOf: new Date(nowMs).toISOString(),
        maxCostClass: highestAllowedCostClassForTarget(budgetState, limits),
        maxSourceCount: limits.maxSourcesPerTarget,
        disappearanceRuleHours,
        historicalLookbackDays,
      });

      perTarget.push(result.outcome);
      if (result.outcome.outcome === "succeeded") succeeded += 1;
      else failed += 1;
      observationsPersistedTotal += result.outcome.observationsPersisted;
      for (const [source, count] of Object.entries(result.bySource)) {
        bySourceCoverage[source] = (bySourceCoverage[source] ?? 0) + count;
      }
      // Comptabilité budgétaire RUN-WIDE mise à jour APRÈS COUP à partir des sources RÉELLEMENT interrogées (voir la limite connue documentée en en-tête de fichier).
      for (const costClass of result.queriedCostClasses) budgetState = recordSourceQueried(budgetState, costClass);
    } catch (error) {
      // Une défaillance INATTENDUE sur une cible n'interrompt jamais le lot (section 3) — classée prudemment comme panne transitoire, jamais silencieusement ignorée.
      const safeMessage = error instanceof Error ? error.message : "erreur inconnue";
      logger.warn({ productKey: target.productKey, error: safeMessage }, "Rafraîchissement de cible : échec inattendu, cible reprogrammée prudemment");
      const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: target.consecutiveFailures, costClass: "free" });
      await updateResearchTargetAfterCycle(options.db, target, decision, new Date(nowMs).toISOString(), safeMessage);
      failed += 1;
      perTarget.push({ productKey: target.productKey, outcome: "failed", failureReason: "transient_source_outage", observationsPersisted: 0, nextRefreshAt: computeNextRefreshAtIso(nowMs, decision.delayHours), priority: target.priority });
    } finally {
      const released = await releaseResearchTarget(options.db, target.id, options.leaseOwner);
      if (!released) {
        logger.warn({ productKey: target.productKey, targetId: target.id }, "Libération de bail refusée — bail probablement déjà expiré et repris par un autre worker");
      }
    }
  }

  return {
    considered,
    claimed: claimedCount,
    skippedLocked: Math.max(0, considered - claimedCount),
    succeeded,
    failed,
    rescheduled: succeeded + failed,
    observationsPersisted: observationsPersistedTotal,
    bySourceCoverage,
    elapsedMs: (options.now?.() ?? new Date()).getTime() - startedAtMs,
    perTarget,
  };
}

function highestAllowedCostClassForTarget(state: RefreshBudgetState, limits: RefreshBudgetLimits): CostClass {
  if (state.highCostSourcesQueriedThisRun >= limits.maxHighCostSourcesPerRun) return "paid";
  return "high_cost";
}

function computeNextRefreshAtIso(nowMs: number, delayHours: number): string {
  return new Date(nowMs + delayHours * 60 * 60 * 1000).toISOString();
}

async function updateResearchTargetAfterCycle(
  db: SupabaseClient,
  target: ResearchTargetRow,
  decision: { isSuccess: boolean; delayHours: number; priorityAdjustment: number; reason: string },
  asOf: string,
  lastError: string | null,
): Promise<void> {
  const nextRefreshAt = computeNextRefreshAtIso(Date.parse(asOf), decision.delayHours);
  const nextPriority = Math.max(0, Math.min(100, target.priority + decision.priorityAdjustment));
  await db
    .from("research_targets")
    .update({
      next_refresh_at: nextRefreshAt,
      priority: nextPriority,
      last_refreshed_at: asOf,
      last_success_at: decision.isSuccess ? asOf : target.lastSuccessAt,
      consecutive_failures: decision.isSuccess ? 0 : target.consecutiveFailures + 1,
      last_error: decision.isSuccess ? null : lastError ?? decision.reason,
    })
    .eq("id", target.id);
}

interface RefreshOneTargetInput {
  db: SupabaseClient;
  target: ResearchTargetRow;
  asOf: string;
  maxCostClass: CostClass;
  maxSourceCount: number;
  disappearanceRuleHours: number;
  historicalLookbackDays: number;
}

interface RefreshOneTargetResult {
  outcome: PerTargetRefreshOutcome;
  bySource: Record<string, number>;
  /** Une entrée par source RÉELLEMENT interrogée ce cycle (jamais par observation) — alimente la comptabilité budgétaire run-wide, voir l'appelant. */
  queriedCostClasses: CostClass[];
}

async function refreshOneTarget(input: RefreshOneTargetInput): Promise<RefreshOneTargetResult> {
  const { db, target, asOf } = input;

  const identity = await loadCanonicalProductIdentity(db, target.productKey);
  if (!identity) {
    // Aucune identité canonique connue pour cette cible — jamais une catégorie/des champs fabriqués. Les cibles sont normalement amorcées APRÈS une analyse interactive réussie (qui persiste déjà l'identité) ; ce cas reste un filet de sécurité, pas le chemin nominal.
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "identity_too_weak", consecutiveFailures: target.consecutiveFailures, costClass: "free" });
    await updateResearchTargetAfterCycle(db, target, decision, asOf, decision.reason);
    return {
      outcome: { productKey: target.productKey, outcome: "failed", failureReason: "identity_too_weak", observationsPersisted: 0, nextRefreshAt: computeNextRefreshAtIso(Date.parse(asOf), decision.delayHours), priority: Math.max(0, Math.min(100, target.priority)) },
      bySource: {},
      queriedCostClasses: [],
    };
  }

  const healthSummary = summarizeIdentityHealth(identity, KNOWN_SOURCE_QUERY_PROFILES);
  const safeIdentityForPlanning = stripConflictedFields(identity);

  const result = await takeProductSnapshot({
    identity: safeIdentityForPlanning,
    categorySlug: identity.categorySlug,
    desiredCurrency: target.desiredCurrency,
    db,
    maxCostClass: input.maxCostClass,
    maxSourceCount: input.maxSourceCount,
  });

  const collectedEvidence = result.summary.observationCount > 0;
  const persistenceFailed = Boolean(result.persistenceError || result.identityPersistenceError || result.fxPersistenceError);
  const hasUsefulEvidence = collectedEvidence && !persistenceFailed;

  let failureReason: RefreshFailureReason | undefined;
  if (!hasUsefulEvidence) {
    if (collectedEvidence && persistenceFailed) failureReason = "persistence_only_failure";
    else if (healthSummary.unresolvedConflictCount > 0 && healthSummary.exactSearchableSources.length === 0) failureReason = "hard_data_conflict";
    else if (healthSummary.exactSearchableSources.length === 0 && healthSummary.fallbackOnlySources.length === 0) failureReason = "identity_too_weak";
    // sinon : laissé indéfini -> repli par défaut "all_sources_unavailable" à l'intérieur de `decideRefreshRetry`.
  }

  const costClass = highestCostClassQueried(result.coverageReport.perSource);
  const bySource: Record<string, number> = {};
  for (const entry of result.coverageReport.perSource) bySource[entry.source] = (bySource[entry.source] ?? 0) + entry.observationCount;

  // Enrichissement d'identité par rétroaction (section 8) — persisté UNIQUEMENT si au moins une observation a fourni un identifiant exploitable, jamais un appel de persistance vide.
  if (result.observations.length > 0) {
    const enriched = enrichIdentityFromObservations(identity, result.observations);
    if (enriched.observationsWithIdentifiers > 0) {
      try {
        await persistCanonicalProductIdentity(db, enriched.identity);
      } catch (error) {
        logger.warn({ productKey: target.productKey, error: error instanceof Error ? error.message : "erreur inconnue" }, "Persistance de l'enrichissement d'identité impossible — cycle non bloqué");
      }
    }

    try {
      await reconcileAndPersistListingLifecycles({
        supabase: db,
        productKey: target.productKey,
        observations: result.observations,
        asOf,
        disappearanceRuleHours: input.disappearanceRuleHours,
      });
    } catch (error) {
      logger.warn({ productKey: target.productKey, error: error instanceof Error ? error.message : "erreur inconnue" }, "Réconciliation du cycle de vie d'annonces impossible — cycle non bloqué");
    }
  }

  try {
    const sinceIso = new Date(Date.parse(asOf) - input.historicalLookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const historicalPoints = await queryHistoricalPricePoints(db, target.productKey, { sinceIso });
    await persistMarketSnapshotSummary({
      supabase: db,
      productKey: target.productKey,
      asOf,
      currency: target.desiredCurrency,
      normalizedRange: result.summary.normalizedRange,
      observations: result.observations,
      historicalPoints,
      activeSupplyCount: result.observations.length,
      coverageScore: result.coverageReport.sourcesQueried > 0 ? Math.round((result.coverageReport.sourcesSucceeded / result.coverageReport.sourcesQueried) * 100) : null,
    });
  } catch (error) {
    logger.warn({ productKey: target.productKey, error: error instanceof Error ? error.message : "erreur inconnue" }, "Persistance du résumé de cycle impossible — cycle non bloqué");
  }

  const priceVolatility = computeVolatility(result.observations.map((o) => ({ observedAt: o.observedAt, priceCents: o.priceAmountCents, source: o.source })))?.coefficientOfVariation ?? null;
  const recentActivity = target.consecutiveFailures === 0 && (target.reason === "user_scan" || target.reason === "watchlist" || target.reason === "high_activity");

  let decision: { isSuccess: boolean; delayHours: number; priorityAdjustment: number; reason: string };
  let nextRefreshAt: string;
  let nextPriority: number;
  if (hasUsefulEvidence) {
    // `lastRefreshedAt: asOf` (jamais `target.lastRefreshedAt`, qui reflète l'état AVANT ce cycle) — ce cycle vient de RÉELLEMENT rafraîchir la cible à `asOf`, donc la planification du PROCHAIN cycle doit repartir de ce point, jamais retomber sur la branche "jamais rafraîchi -> éligible immédiatement" qui reclamerait la cible en boucle au tour suivant.
    const scheduling = decideNextSnapshotRefresh({ asOf, lastRefreshedAt: asOf, priceVolatility, recentActivity, costClass });
    decision = { isSuccess: true, delayHours: 0, priorityAdjustment: 0, reason: scheduling.reason };
    nextRefreshAt = scheduling.nextRefreshAt;
    nextPriority = scheduling.priority;
  } else {
    const retry = decideRefreshRetry({ hasUsefulEvidence: false, failureReason, consecutiveFailures: target.consecutiveFailures, costClass });
    decision = retry;
    nextRefreshAt = computeNextRefreshAtIso(Date.parse(asOf), retry.delayHours);
    nextPriority = Math.max(0, Math.min(100, target.priority + retry.priorityAdjustment));
  }

  await db
    .from("research_targets")
    .update({
      next_refresh_at: nextRefreshAt,
      priority: nextPriority,
      last_refreshed_at: asOf,
      last_success_at: hasUsefulEvidence ? asOf : target.lastSuccessAt,
      consecutive_failures: hasUsefulEvidence ? 0 : target.consecutiveFailures + 1,
      last_error: hasUsefulEvidence ? null : decision.reason,
    })
    .eq("id", target.id);

  return {
    outcome: {
      productKey: target.productKey,
      outcome: hasUsefulEvidence ? "succeeded" : "failed",
      failureReason: hasUsefulEvidence ? undefined : (failureReason ?? "all_sources_unavailable"),
      observationsPersisted: result.observationsPersisted ?? 0,
      nextRefreshAt,
      priority: nextPriority,
    },
    bySource,
    queriedCostClasses: result.coverageReport.perSource.map((entry) => entry.costClass),
  };
}
