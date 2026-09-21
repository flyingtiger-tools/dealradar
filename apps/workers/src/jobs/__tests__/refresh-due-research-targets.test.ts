import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import type { MarketSnapshotResult } from "@dealradar/ingestion";

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
      skippedForMissingRateCount: 0,
      normalizedCurrency: "CHF",
      normalizedRange: observations.length > 0 ? { medianCents: 18000, p25Cents: 17500, p75Cents: 18500, sampleSize: observations.length } : null,
    },
    ...overrides,
  };
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
    summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
  });
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
    vi.mocked(takeProductSnapshot).mockResolvedValue(successResult());
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

  it("aucune observation obtenue -> échec, consecutive_failures incrémenté, jamais compté comme un succès", async () => {
    vi.mocked(takeProductSnapshot).mockResolvedValue(emptyResult());
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
    vi.mocked(takeProductSnapshot).mockResolvedValue(successResult());
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
      limits: { maxTargetsPerRun: 1, maxSourcesPerTarget: 6, maxPaidSourcesPerTarget: 3, maxHighCostSourcesPerRun: 2, totalRunTimeoutMs: 300000 },
    });

    expect(summary.claimed).toBe(1);
    expect(summary.considered).toBe(2);
    expect(summary.skippedLocked).toBe(1);
  });

  it("une défaillance INATTENDUE sur une cible n'interrompt jamais le lot — la cible suivante est quand même traitée", async () => {
    vi.mocked(takeProductSnapshot).mockRejectedValueOnce(new Error("panne réseau simulée")).mockResolvedValueOnce(successResult({ productKey: "lego:10301", observations: [fakeObservation({ productKey: "lego:10301" })] }));
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
