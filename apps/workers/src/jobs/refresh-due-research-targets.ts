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
  persistRefreshRunAudit,
  type ResearchTargetRow,
  type RefreshRunTargetAuditInput,
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
 * Flux par cible réclamée (section 3, mis à jour section 4) : charger
 * l'identité canonique persistée → construire un plan de requête SÛR (`stripConflictedFields`,
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
 * ENFORCEMENT EXACT (LOT "Real DB Integration...", section 3/4) : le budget
 * run-wide est propagé de cible en cible via `selectionPlan.budgetStateAfter`
 * — la sélection elle-même applique déjà `canQuerySource`/`recordSourceQueried`
 * AVANT de choisir une source, jamais après coup.
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
  /** `true` uniquement sur un SUCCÈS où au moins une observation a été écartée de la fusion faute de taux (manquant OU périmé) alors que d'autres restaient exploitables — succès réel, mais avec un avertissement FX explicite (LOT "Real DB Integration...", section 5), jamais confondu avec `fx_unavailable` (blocage TOTAL, classé comme échec). */
  fxWarning: boolean;
  observationsPersisted: number;
  nextRefreshAt: string;
  priority: number;
}

export interface RunDueMarketRefreshBatchSummary {
  /** Identifiant STABLE de ce run — clé d'idempotence de son audit (`market_refresh_runs.run_key`, section 6), jamais réutilisé. */
  runKey: string;
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
  /** `true` si le run s'est arrêté parce que `totalRunTimeoutMs` a été atteint (LOT "Real DB Integration...", section 8) — les cibles restantes dues ne sont alors jamais marquées rafraîchies, simplement différées au run suivant. */
  timedOut: boolean;
  /** `true` si le run s'est arrêté parce que `maxTargetsPerRun` a été atteint avant d'épuiser les cibles dues — distinct d'un arrêt par délai. */
  budgetExhausted: boolean;
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

  const runKey = crypto.randomUUID();
  const dueAtStart = await queryDueResearchTargets(options.db, { limit: CONSIDERED_PREVIEW_LIMIT, now: new Date(startedAtMs) });
  const considered = dueAtStart.length;

  // Annulation COOPÉRATIVE (LOT "Interactive History + Generic Result UI +
  // Full Cancellation + Pre-Prod Activation Package", section 7) — UN SEUL
  // `AbortController` pour tout le run, dont le signal est transmis à
  // `refreshOneTarget` -> `takeProductSnapshot` -> `takeMarketSnapshot` ->
  // `aggregateMarketObservations` -> CHAQUE `MarketSourceQuery.signal`.
  // Déclenché sur `limits.totalRunTimeoutMs` de TEMPS RÉEL écoulé (jamais
  // dérivé de `options.now`, qui ne pilote que les calculs de
  // planification injectables pour les tests — un appel réseau en vol ne
  // peut de toute façon être abandonné que par une horloge réelle).
  // `canProcessAnotherTarget` (boucle ci-dessous) empêche déjà le
  // LANCEMENT de nouvelles cibles à la même échéance (comportement
  // préexistant) — ce contrôleur ajoute l'abandon des appels DÉJÀ EN VOL,
  // jamais un remplacement.
  const batchController = new AbortController();
  const deadlineTimer = setTimeout(() => batchController.abort(), limits.totalRunTimeoutMs);

  let budgetState: RefreshBudgetState = initialRefreshBudgetState(startedAtMs);
  const perTarget: PerTargetRefreshOutcome[] = [];
  const auditTargets: RefreshRunTargetAuditInput[] = [];
  const bySourceCoverage: Record<string, number> = {};
  const sourceCountsByStatus: Record<string, number> = {};
  let claimedCount = 0;
  let succeeded = 0;
  let failed = 0;
  let observationsPersistedTotal = 0;
  let timedOut = false;
  let budgetExhausted = false;

  for (;;) {
    const nowMs = (options.now?.() ?? new Date()).getTime();
    const budgetCheck = canProcessAnotherTarget(budgetState, limits, nowMs);
    if (!budgetCheck.allowed) {
      // Distingue la cause d'arrêt (section 8) — jamais devinée depuis le texte de `budgetCheck.reason`, recalculée directement à partir des mêmes conditions que `canProcessAnotherTarget`.
      timedOut = nowMs - startedAtMs >= limits.totalRunTimeoutMs;
      budgetExhausted = !timedOut && budgetState.targetsProcessed >= limits.maxTargetsPerRun;
      break;
    }

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
        budgetState,
        budgetLimits: limits,
        disappearanceRuleHours,
        historicalLookbackDays,
        signal: batchController.signal,
      });

      perTarget.push(result.outcome);
      auditTargets.push(result.auditDetail);
      if (result.outcome.outcome === "succeeded") succeeded += 1;
      else failed += 1;
      observationsPersistedTotal += result.outcome.observationsPersisted;
      for (const [source, count] of Object.entries(result.bySource)) {
        bySourceCoverage[source] = (bySourceCoverage[source] ?? 0) + count;
      }
      // Le budget résultant de la SÉLECTION (déjà exact, décidée avant requête) devient l'état de départ de la cible suivante — jamais un recalcul après coup.
      budgetState = result.budgetStateAfter;
    } catch (error) {
      // Une défaillance INATTENDUE sur une cible n'interrompt jamais le lot (section 3) — classée prudemment comme panne transitoire, jamais silencieusement ignorée.
      const safeMessage = error instanceof Error ? error.message : "erreur inconnue";
      logger.warn({ productKey: target.productKey, error: safeMessage }, "Rafraîchissement de cible : échec inattendu, cible reprogrammée prudemment");
      const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "transient_source_outage", consecutiveFailures: target.consecutiveFailures, costClass: "free" });
      const asOf = new Date(nowMs).toISOString();
      await updateResearchTargetAfterCycle(options.db, target, decision, asOf, safeMessage);
      failed += 1;
      const nextRefreshAt = computeNextRefreshAtIso(nowMs, decision.delayHours);
      perTarget.push({ productKey: target.productKey, outcome: "failed", failureReason: "transient_source_outage", fxWarning: false, observationsPersisted: 0, nextRefreshAt, priority: target.priority });
      auditTargets.push({
        researchTargetId: target.id,
        productKey: target.productKey,
        claimedAt: target.claimedAt,
        startedAt: asOf,
        finishedAt: asOf,
        outcome: "failed",
        failureReason: "transient_source_outage",
        selectedSources: [],
        skippedSourceReasons: {},
        observationsReturned: 0,
        observationsPersisted: 0,
        fxSkippedCount: 0,
        identityConflictCount: 0,
        nextRefreshAt,
        safeErrorClass: "transient_source_outage",
      });
    } finally {
      const released = await releaseResearchTarget(options.db, target.id, options.leaseOwner);
      if (!released) {
        logger.warn({ productKey: target.productKey, targetId: target.id }, "Libération de bail refusée — bail probablement déjà expiré et repris par un autre worker");
      }
    }
  }

  clearTimeout(deadlineTimer); // jamais un minuteur qui traîne après la fin du run — voir la déclaration ci-dessus.

  const targetCountsByOutcome: Record<string, number> = {};
  const errorClassCounts: Record<string, number> = {};
  for (const t of perTarget) {
    const key = t.outcome === "succeeded" ? "succeeded" : (t.failureReason ?? "unknown");
    targetCountsByOutcome[key] = (targetCountsByOutcome[key] ?? 0) + 1;
    if (t.outcome === "failed") errorClassCounts[t.failureReason ?? "unknown"] = (errorClassCounts[t.failureReason ?? "unknown"] ?? 0) + 1;
  }
  for (const t of auditTargets) {
    for (const source of t.selectedSources) sourceCountsByStatus[source] = (sourceCountsByStatus[source] ?? 0) + 1;
  }

  const finishedAtMs = (options.now?.() ?? new Date()).getTime();
  const summary: RunDueMarketRefreshBatchSummary = {
    runKey,
    considered,
    claimed: claimedCount,
    skippedLocked: Math.max(0, considered - claimedCount),
    succeeded,
    failed,
    rescheduled: succeeded + failed,
    observationsPersisted: observationsPersistedTotal,
    bySourceCoverage,
    elapsedMs: finishedAtMs - startedAtMs,
    timedOut,
    budgetExhausted,
    perTarget,
  };

  // Persistance d'audit ISOLÉE (section 6/7) — un échec ici ne doit JAMAIS faire échouer le lot lui-même, ni masquer le résumé déjà calculé.
  try {
    await persistRefreshRunAudit({
      supabase: options.db,
      runKey,
      leaseOwner: options.leaseOwner,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      considered,
      claimed: claimedCount,
      succeeded,
      failed,
      observationsPersisted: observationsPersistedTotal,
      targetCountsByOutcome,
      sourceCountsByStatus,
      errorClassCounts,
      elapsedMs: summary.elapsedMs,
      timedOut,
      budgetExhausted,
      targets: auditTargets,
    });
  } catch (error) {
    logger.warn({ runKey, error: error instanceof Error ? error.message : "erreur inconnue" }, "Persistance de l'audit de run impossible — résumé du lot non affecté");
  }

  return summary;
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
  budgetState: RefreshBudgetState;
  budgetLimits: RefreshBudgetLimits;
  disappearanceRuleHours: number;
  historicalLookbackDays: number;
  /** Déadline de CE RUN (LOT "Interactive History + Generic Result UI + Full Cancellation + Pre-Prod Activation Package", section 7) — voir `runDueMarketRefreshBatch`, un seul `AbortController` partagé par tout le run. */
  signal?: AbortSignal;
}

interface RefreshOneTargetResult {
  outcome: PerTargetRefreshOutcome;
  bySource: Record<string, number>;
  /** État du budget APRÈS la sélection EXACTE de sources pour cette cible (`SourceSelectionPlan.budgetStateAfter`) — jamais recalculé après coup. */
  budgetStateAfter: RefreshBudgetState;
  /** Détail d'audit PAR CIBLE (section 7) — métadonnées sûres uniquement, jamais un payload brut complet. */
  auditDetail: RefreshRunTargetAuditInput;
}

async function refreshOneTarget(input: RefreshOneTargetInput): Promise<RefreshOneTargetResult> {
  const { db, target, asOf } = input;

  const identity = await loadCanonicalProductIdentity(db, target.productKey);
  if (!identity) {
    // Aucune identité canonique connue pour cette cible — jamais une catégorie/des champs fabriqués. Les cibles sont normalement amorcées APRÈS une analyse interactive réussie (qui persiste déjà l'identité) ; ce cas reste un filet de sécurité, pas le chemin nominal.
    const decision = decideRefreshRetry({ hasUsefulEvidence: false, failureReason: "identity_too_weak", consecutiveFailures: target.consecutiveFailures, costClass: "free" });
    await updateResearchTargetAfterCycle(db, target, decision, asOf, decision.reason);
    const nextRefreshAt = computeNextRefreshAtIso(Date.parse(asOf), decision.delayHours);
    return {
      outcome: { productKey: target.productKey, outcome: "failed", failureReason: "identity_too_weak", fxWarning: false, observationsPersisted: 0, nextRefreshAt, priority: Math.max(0, Math.min(100, target.priority)) },
      bySource: {},
      budgetStateAfter: input.budgetState,
      auditDetail: {
        researchTargetId: target.id,
        productKey: target.productKey,
        claimedAt: target.claimedAt,
        startedAt: asOf,
        finishedAt: asOf,
        outcome: "failed",
        failureReason: "identity_too_weak",
        selectedSources: [],
        skippedSourceReasons: {},
        observationsReturned: 0,
        observationsPersisted: 0,
        fxSkippedCount: 0,
        identityConflictCount: 0,
        nextRefreshAt,
        safeErrorClass: "identity_too_weak",
      },
    };
  }

  const healthSummary = summarizeIdentityHealth(identity, KNOWN_SOURCE_QUERY_PROFILES);
  const safeIdentityForPlanning = stripConflictedFields(identity);

  const { snapshot: result, selectionPlan } = await takeProductSnapshot({
    identity: safeIdentityForPlanning,
    categorySlug: identity.categorySlug,
    desiredCurrency: target.desiredCurrency,
    db,
    identityHealth: healthSummary,
    budgetState: input.budgetState,
    budgetLimits: input.budgetLimits,
    signal: input.signal,
  });

  const rawObservationCount = result.summary.observationCount;
  const collectedEvidence = rawObservationCount > 0;
  const persistenceFailed = Boolean(result.persistenceError || result.identityPersistenceError || result.fxPersistenceError);
  // Distinction section 5 : `skippedForMissingRateCount`/`staleRateCount` comptent UNIQUEMENT les observations écartées de la vue normalisée faute de taux — jamais confondu avec des observations simplement absentes.
  const fxSkippedCount = result.summary.skippedForMissingRateCount + result.summary.staleRateCount;
  const normalizedUsableCount = rawObservationCount - fxSkippedCount;
  // Blocage TOTAL par FX : des observations ont bien été collectées (et persistées, chacune dans sa devise d'origine) mais AUCUNE n'est exploitable pour la vue normalisée, uniquement à cause du change — jamais confondu avec "aucune observation du tout".
  const fxFullyBlocked = collectedEvidence && !persistenceFailed && normalizedUsableCount === 0 && fxSkippedCount > 0;
  // Succès partiel : au moins une observation reste exploitable malgré un avertissement FX sur d'autres — un succès réel, jamais reclassé en échec pour ce seul motif.
  const fxWarning = collectedEvidence && !persistenceFailed && normalizedUsableCount > 0 && fxSkippedCount > 0;
  const hasUsefulEvidence = collectedEvidence && !persistenceFailed && !fxFullyBlocked;

  // Signal de RUNTIME dédié pour "policy_disabled_source_set" (section 9) — SEULE cause du blocage : chaque source candidate a été exclue PAR POLITIQUE (restricted/disabled_policy/license_required), jamais confondu avec des credentials manquantes/un budget épuisé/une identité insuffisante (chacun de ces trois autres motifs, s'il en existe UN SEUL, prend le pas — la politique n'est "la" cause que si elle est la SEULE).
  const allBlockedByPolicyOnly =
    selectionPlan.selectedSources.length === 0 &&
    selectionPlan.excludedByPolicy.length > 0 &&
    selectionPlan.excludedByMissingCredentials.length === 0 &&
    selectionPlan.excludedByCostBudget.length === 0 &&
    selectionPlan.excludedByIdentityWeakness.length === 0;

  // Abandon par la déadline du RUN (section 7/8) — au moins une source
  // interrogée pour cette cible a été abandonnée par `input.signal`, jamais
  // une panne fournisseur. Vérifié EN PREMIER : quand présent, c'est
  // TOUJOURS l'explication la plus pertinente d'une absence de preuve pour
  // ce cycle précis, prioritaire sur les autres classifications.
  const anySourceAborted = result.coverageReport.perSource.some((s) => s.status === "aborted");

  let failureReason: RefreshFailureReason | undefined;
  if (!hasUsefulEvidence) {
    if (anySourceAborted) failureReason = "run_deadline_exceeded";
    else if (collectedEvidence && persistenceFailed) failureReason = "persistence_only_failure";
    else if (fxFullyBlocked) failureReason = "fx_unavailable";
    else if (healthSummary.unresolvedConflictCount > 0 && healthSummary.exactSearchableSources.length === 0) failureReason = "hard_data_conflict";
    else if (allBlockedByPolicyOnly) failureReason = "policy_disabled_source_set";
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

  // `run_deadline_exceeded` n'incrémente JAMAIS `consecutive_failures`
  // (section 8 : "do not penalize source health for operator cancellation")
  // — ce compteur alimente le backoff exponentiel d'autres motifs d'échec
  // (`boundedBackoffHours`), jamais approprié pour une annulation opérateur.
  const countsAsConsecutiveFailure = !hasUsefulEvidence && failureReason !== "run_deadline_exceeded";
  await db
    .from("research_targets")
    .update({
      next_refresh_at: nextRefreshAt,
      priority: nextPriority,
      last_refreshed_at: asOf,
      last_success_at: hasUsefulEvidence ? asOf : target.lastSuccessAt,
      consecutive_failures: countsAsConsecutiveFailure ? target.consecutiveFailures + 1 : hasUsefulEvidence ? 0 : target.consecutiveFailures,
      last_error: hasUsefulEvidence ? null : decision.reason,
    })
    .eq("id", target.id);

  const resolvedFailureReason = hasUsefulEvidence ? undefined : (failureReason ?? "all_sources_unavailable");
  const skippedSourceReasons: Record<string, string> = {};
  for (const entry of selectionPlan.entries) {
    if (!entry.included) skippedSourceReasons[entry.source] = entry.reason;
  }

  return {
    outcome: {
      productKey: target.productKey,
      outcome: hasUsefulEvidence ? "succeeded" : "failed",
      failureReason: resolvedFailureReason,
      fxWarning,
      observationsPersisted: result.observationsPersisted ?? 0,
      nextRefreshAt,
      priority: nextPriority,
    },
    bySource,
    budgetStateAfter: selectionPlan.budgetStateAfter,
    auditDetail: {
      researchTargetId: target.id,
      productKey: target.productKey,
      claimedAt: target.claimedAt,
      startedAt: asOf,
      finishedAt: asOf,
      outcome: hasUsefulEvidence ? "succeeded" : "failed",
      failureReason: resolvedFailureReason ?? null,
      selectedSources: selectionPlan.selectedSources,
      skippedSourceReasons,
      observationsReturned: rawObservationCount,
      observationsPersisted: result.observationsPersisted ?? 0,
      fxSkippedCount,
      identityConflictCount: healthSummary.unresolvedConflictCount,
      nextRefreshAt,
      safeErrorClass: resolvedFailureReason ?? null,
    },
  };
}
