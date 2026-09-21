import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import type { MarketSnapshotResult, SourceSelectionPlan } from "@dealradar/ingestion";
import { initialRefreshBudgetState, DEFAULT_REFRESH_BUDGET_LIMITS as DEFAULT_LIMITS, type RefreshBudgetState } from "@dealradar/core";

vi.mock("../take-product-snapshot", () => ({ takeProductSnapshot: vi.fn() }));

const { takeProductSnapshot } = await import("../take-product-snapshot");
const { runDueMarketRefreshBatch } = await import("../refresh-due-research-targets");
const { FakeSupabase } = await import("./fake-supabase");
const { installSimulatedResearchTargetLeaseRpcs } = await import("./simulate-research-target-leases");

const NOW = new Date("2026-09-21T12:00:00.000Z");

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "bricklink",
    sourceItemId: "1",
    sourceUrl: null,
    observedAt: NOW.toISOString(),
    productKey: "lego:10300",
    query: "10300",
    title: "LEGO 10300",
    brand: "LEGO",
    model: "10300",
    variant: null,
    identifiers: {},
    condition: "new",
    completeness: null,
    priceAmountCents: 18000,
    currency: "CHF",
    shippingCostCents: null,
    totalPriceCents: null,
    country: "CH",
    marketplace: "bricklink",
    evidenceType: "historicalPrices",
    evidenceTier: "B",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

function successResult(overrides: Partial<MarketSnapshotResult> = {}): MarketSnapshotResult {
  const observations = overrides.observations ?? [fakeObservation()];
  return {
    productKey: "lego:10300",
    asOf: NOW.toISOString(),
    searchPlansUsed: [],
    coverageReport: {
      categorySlug: "lego",
      asOf: NOW.toISOString(),
      sourcesQueried: 1,
      sourcesSucceeded: 1,
      sourcesFailed: 0,
      perSource: [{ source: "bricklink", status: "success", observationCount: observations.length, latencyMs: 10, costClass: "free" }],
      observationsReturned: observations.length,
      observationsAfterCanonicalDedupe: observations.length,
      observationsUsableAfterFx: observations.length,
      observationsPersisted: observations.length,
      medianLatencyMs: 10,
    },
    observations,
    observationsPersisted: observations.length,
    persistenceError: null,
    identityPersisted: true,
    identityPersistenceError: null,
    fxRatesPersistedCount: null,
    fxPersistenceError: null,
    summary: {
      observationCount: observations.length,
      sourceDiversity: 1,
      currenciesObserved: ["CHF"],
      skippedForMissingRateCount: 0, staleRateCount: 0,
      normalizedCurrency: "CHF",
      normalizedRange: observations.length > 0 ? { medianCents: 18000, p25Cents: 17500, p75Cents: 18500, sampleSize: observations.length } : null,
    },
    ...overrides,
  };
}

function abortedResult(): MarketSnapshotResult {
  return successResult({
    observations: [],
    coverageReport: {
      categorySlug: "lego",
      asOf: NOW.toISOString(),
      sourcesQueried: 1,
      sourcesSucceeded: 0,
      sourcesFailed: 1,
      perSource: [{ source: "bricklink", status: "aborted", observationCount: 0, latencyMs: 10, costClass: "free" }],
      observationsReturned: 0,
      observationsAfterCanonicalDedupe: 0,
      observationsUsableAfterFx: 0,
      observationsPersisted: 0,
      medianLatencyMs: 10,
    },
    observationsPersisted: 0,
    summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, staleRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
  });
}

function emptyResult(): MarketSnapshotResult {
  return successResult({
    observations: [],
    coverageReport: {
      categorySlug: "lego",
      asOf: NOW.toISOString(),
      sourcesQueried: 1,
      sourcesSucceeded: 0,
      sourcesFailed: 1,
      perSource: [{ source: "bricklink", status: "error", observationCount: 0, latencyMs: 10, costClass: "free" }],
      observationsReturned: 0,
      observationsAfterCanonicalDedupe: 0,
      observationsUsableAfterFx: 0,
      observationsPersisted: 0,
      medianLatencyMs: 10,
    },
    observationsPersisted: 0,
    summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, staleRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
  });
}

/**
 * `budgetStateAfter` DOIT échoir l'état RÉELLEMENT reçu en entrée (jamais
 * un état frais fabriqué) — dans le vrai `buildSourceSelectionPlan`,
 * `budgetStateAfter` dérive TOUJOURS de l'état d'entrée via
 * `recordSourceQueried` (jamais réinitialisé), donc un double qui
 * l'ignorerait romprait silencieusement `targetsProcessed`/les compteurs
 * run-wide entre deux cibles simulées.
 */
function fakeSelectionPlan(inputBudgetState: RefreshBudgetState, overrides: Partial<SourceSelectionPlan> = {}): SourceSelectionPlan {
  return {
    categorySlug: "lego",
    eligibleSources: ["bricklink"],
    excludedByPolicy: [],
    excludedByMissingCredentials: [],
    excludedByIdentityWeakness: [],
    excludedByCostBudget: [],
    selectedSources: ["bricklink"],
    selectionOrder: ["bricklink"],
    entries: [],
    projectedCostClasses: { bricklink: "free" },
    budgetStateAfter: { ...inputBudgetState, sourcesQueriedForCurrentTarget: inputBudgetState.sourcesQueriedForCurrentTarget + 1 },
    ...overrides,
  };
}

function fakeOutput(snapshot: MarketSnapshotResult, inputBudgetState = initialRefreshBudgetState(NOW.getTime()), selectionPlan: Partial<SourceSelectionPlan> = {}) {
  return { snapshot, selectionPlan: fakeSelectionPlan(inputBudgetState, selectionPlan) };
}

function researchTargetRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    product_key: "lego:10300",
    reason: "user_scan",
    priority: 50,
    desired_currency: "CHF",
    enabled: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    last_refreshed_at: null,
    next_refresh_at: null,
    claimed_by: null,
    claimed_at: null,
    lease_expires_at: null,
    attempt_count: 0,
    last_error: null,
    last_success_at: null,
    consecutive_failures: 0,
    ...overrides,
  };
}

/** `FakeSupabase.seed` REMPLACE toute la table — accumule donc explicitement plutôt que d'écraser une identité déjà semée pour un autre produit dans le même test. */
function seedIdentity(db: InstanceType<typeof FakeSupabase>, productKey: string, categorySlug: string) {
  db.seed("market_products", [
    ...db.table("market_products"),
    { product_key: productKey, category_slug: categorySlug, last_seen_at: NOW.toISOString() },
  ]);
  db.seed("market_product_identifiers", [
    ...db.table("market_product_identifiers"),
    { product_key: productKey, field: "bricklinkNo", value: "10300", source: "bricklink", confidence: 0.9, observed_at: "2026-09-01T00:00:00.000Z" },
  ]);
}

beforeEach(() => {
  vi.mocked(takeProductSnapshot).mockReset();
});

describe("runDueMarketRefreshBatch", () => {
  it("traite une cible due avec succès : rescheduled dans le futur, consecutive_failures remis à 0", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(successResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.considered).toBe(1);
    expect(summary.claimed).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.rescheduled).toBe(1);
    expect(summary.observationsPersisted).toBe(1);
    expect(summary.bySourceCoverage.bricklink).toBe(1);

    const row = db.table("research_targets")[0] as Record<string, unknown>;
    expect(row.consecutive_failures).toBe(0);
    expect(Date.parse(row.next_refresh_at as string)).toBeGreaterThan(NOW.getTime());
    expect(row.claimed_by).toBeNull(); // bail toujours libéré en fin de cycle.
  });

  it("aucune identité connue pour la cible -> échec 'identity_too_weak', jamais une catégorie fabriquée, jamais un crash", async () => {
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    db.seed("research_targets", [researchTargetRow({ product_key: "unknown:product", next_refresh_at: null })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.perTarget[0]?.failureReason).toBe("identity_too_weak");
    expect(takeProductSnapshot).not.toHaveBeenCalled();
  });

  it("toutes les sources candidates verrouillées PAR POLITIQUE (aucune autre cause) -> échec 'policy_disabled_source_set', jamais confondu avec 'identity_too_weak'", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) =>
      fakeOutput(emptyResult(), input.budgetState, {
        eligibleSources: ["ricardo"],
        excludedByPolicy: ["ricardo"],
        excludedByMissingCredentials: [],
        excludedByCostBudget: [],
        excludedByIdentityWeakness: [],
        selectedSources: [],
        selectionOrder: [],
      }),
    );
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.failed).toBe(1);
    expect(summary.perTarget[0]?.failureReason).toBe("policy_disabled_source_set");
  });

  it("blocage TOTAL par FX (toutes les observations écartées faute de taux) -> échec 'fx_unavailable', jamais confondu avec une panne de persistance", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) =>
      fakeOutput(
        successResult({
          summary: {
            observationCount: 2,
            sourceDiversity: 1,
            currenciesObserved: ["USD"],
            skippedForMissingRateCount: 2,
            staleRateCount: 0,
            normalizedCurrency: "CHF",
            normalizedRange: null,
          },
        }),
        input.budgetState,
      ),
    );
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(0);
    expect(summary.perTarget[0]?.failureReason).toBe("fx_unavailable");
  });

  it("succès PARTIEL (au moins une observation exploitable malgré des observations écartées pour taux périmé) -> succès avec fxWarning, jamais reclassé en échec", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) =>
      fakeOutput(
        successResult({
          summary: {
            observationCount: 3,
            sourceDiversity: 1,
            currenciesObserved: ["CHF", "USD"],
            skippedForMissingRateCount: 0,
            staleRateCount: 1,
            normalizedCurrency: "CHF",
            normalizedRange: { medianCents: 18000, p25Cents: 17500, p75Cents: 18500, sampleSize: 2 },
          },
        }),
        input.budgetState,
      ),
    );
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.perTarget[0]?.fxWarning).toBe(true);
    expect(summary.perTarget[0]?.failureReason).toBeUndefined();
  });

  it("aucune observation obtenue -> échec, consecutive_failures incrémenté, jamais compté comme un succès", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(emptyResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null, consecutive_failures: 1 })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.failed).toBe(1);
    const row = db.table("research_targets")[0] as Record<string, unknown>;
    expect(row.consecutive_failures).toBe(2);
  });

  it("plafond de cibles par run (maxTargetsPerRun=1) arrête le lot même si une deuxième cible est due", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(successResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    seedIdentity(db, "lego:10301", "lego");
    db.seed("research_targets", [
      researchTargetRow({ id: 1, product_key: "lego:10300", next_refresh_at: null }),
      researchTargetRow({ id: 2, product_key: "lego:10301", next_refresh_at: null }),
    ]);

    const summary = await runDueMarketRefreshBatch({
      db: db as never,
      leaseOwner: "worker-a",
      now: () => NOW,
      limits: { maxTargetsPerRun: 1, maxSourcesPerTarget: 6, maxPaidSourcesPerTarget: 3, maxHighCostSourcesPerTarget: 1, maxHighCostSourcesPerRun: 2, totalRunTimeoutMs: 300000 },
    });

    expect(summary.claimed).toBe(1);
    expect(summary.considered).toBe(2);
    expect(summary.skippedLocked).toBe(1);
    expect(summary.budgetExhausted).toBe(true);
    expect(summary.timedOut).toBe(false);
  });

  it("délai total du run dépassé (totalRunTimeoutMs) -> timedOut, jamais confondu avec budgetExhausted", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(successResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);

    const summary = await runDueMarketRefreshBatch({
      db: db as never,
      leaseOwner: "worker-a",
      now: () => NOW,
      limits: { ...DEFAULT_LIMITS, totalRunTimeoutMs: 0 },
    });

    expect(summary.claimed).toBe(0); // le délai est déjà dépassé AVANT la première réclamation.
    expect(summary.timedOut).toBe(true);
    expect(summary.budgetExhausted).toBe(false);
  });

  it("persiste un audit de run + un audit par cible (market_refresh_runs/market_refresh_run_targets), identifiable par runKey", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(successResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    const runRow = db.table("market_refresh_runs").find((r) => r.run_key === summary.runKey) as Record<string, unknown> | undefined;
    expect(runRow).toBeDefined();
    expect(runRow?.succeeded).toBe(1);
    const targetRows = db.table("market_refresh_run_targets") as Record<string, unknown>[];
    expect(targetRows).toHaveLength(1);
    expect(targetRows[0]?.product_key).toBe("lego:10300");
    expect(targetRows[0]?.outcome).toBe("succeeded");
  });

  it("une panne de persistance d'audit n'interrompt JAMAIS le lot — le résumé reste complet et correct", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(successResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);
    const originalFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      if (table === "market_refresh_runs") throw new Error("panne d'écriture d'audit simulée");
      return originalFrom(table);
    });

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.succeeded).toBe(1);
    expect(summary.claimed).toBe(1);
    expect(db.table("research_targets")[0]?.claimed_by).toBeNull(); // le bail a bien été libéré malgré l'échec d'audit.
  });

  it("une défaillance INATTENDUE sur une cible n'interrompt jamais le lot — la cible suivante est quand même traitée", async () => {
    vi.mocked(takeProductSnapshot).mockImplementationOnce(async () => {
      throw new Error("panne réseau simulée");
    });
    vi.mocked(takeProductSnapshot).mockImplementationOnce(async (input) =>
      fakeOutput(successResult({ productKey: "lego:10301", observations: [fakeObservation({ productKey: "lego:10301" })] }), input.budgetState),
    );
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    seedIdentity(db, "lego:10301", "lego");
    db.seed("research_targets", [
      researchTargetRow({ id: 1, product_key: "lego:10300", priority: 90, next_refresh_at: null }),
      researchTargetRow({ id: 2, product_key: "lego:10301", priority: 10, next_refresh_at: null }),
    ]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.claimed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(1);
    // Les deux baux ont été libérés malgré l'échec de la première cible.
    expect(db.table("research_targets").every((r) => r.claimed_by === null)).toBe(true);
  });

  it("annulation coopérative (LOT 'Interactive History...', section 7/8) : coverageReport signale une source ABANDONNÉE -> failureReason 'run_deadline_exceeded', jamais 'transient_source_outage', priorité et consecutive_failures INCHANGÉS", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(abortedResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null, priority: 50, consecutive_failures: 1 })]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    expect(summary.failed).toBe(1);
    expect(summary.perTarget[0]?.failureReason).toBe("run_deadline_exceeded");
    const row = db.table("research_targets")[0] as Record<string, unknown>;
    // Ni pénalité de priorité, ni incrément de consecutive_failures — une annulation opérateur n'est jamais traitée comme un échec du produit/de la source.
    expect(row.priority).toBe(50);
    expect(row.consecutive_failures).toBe(1);
  });

  it("annulation coopérative : un AbortSignal (déadline du run) est TOUJOURS transmis à takeProductSnapshot, même quand il ne se déclenche jamais", async () => {
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => fakeOutput(successResult(), input.budgetState));
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [researchTargetRow({ next_refresh_at: null })]);

    await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    const callArgs = vi.mocked(takeProductSnapshot).mock.calls[0]![0];
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    expect(callArgs.signal?.aborted).toBe(false);
  });

  it("une cible déjà sous bail ACTIF d'un autre worker n'est jamais réclamée — skippedLocked le reflète", async () => {
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);
    seedIdentity(db, "lego:10300", "lego");
    db.seed("research_targets", [
      researchTargetRow({ next_refresh_at: null, claimed_by: "worker-other", lease_expires_at: new Date(NOW.getTime() + 600_000).toISOString() }),
    ]);

    const summary = await runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW });

    // "considered" reflète l'éligibilité BRUTE (activée + échéance due), indépendante du verrouillage — exactement pour que "skippedLocked" puisse mesurer la contention de bail séparément (section 3).
    expect(summary.considered).toBe(1);
    expect(summary.claimed).toBe(0);
    expect(summary.skippedLocked).toBe(1);
    expect(takeProductSnapshot).not.toHaveBeenCalled();
  });
});
