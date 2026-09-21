import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import type { MarketSnapshotResult, SourceSelectionPlan } from "@dealradar/ingestion";
import { initialRefreshBudgetState } from "@dealradar/core";

/**
 * Simulation E2E déterministe locale (LOT "Close the Refresh Loop",
 * section 12) — AUCUN réseau, AUCUNE vraie Postgres. Trois cibles de
 * recherche dues (une réussit pleinement, une subit une panne complète de
 * toutes ses sources, une a un conflit d'identité dur non résolu) traitées
 * par DEUX instances "workers" simulées (`runDueMarketRefreshBatch` appelé
 * deux fois EN PARALLÈLE via `Promise.all`, avec des `leaseOwner`
 * distincts) sur le MÊME état `FakeSupabase` partagé — exactement le
 * scénario de concurrence que le bail atomique (migration 0021) doit
 * prévenir.
 */
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

function baseCoverage(overrides: Partial<MarketSnapshotResult["coverageReport"]> = {}): MarketSnapshotResult["coverageReport"] {
  return {
    categorySlug: "lego",
    asOf: NOW.toISOString(),
    sourcesQueried: 1,
    sourcesSucceeded: 1,
    sourcesFailed: 0,
    perSource: [{ source: "bricklink", status: "success", observationCount: 1, latencyMs: 5, costClass: "free" }],
    observationsReturned: 1,
    observationsAfterCanonicalDedupe: 1,
    observationsUsableAfterFx: 1,
    observationsPersisted: 1,
    medianLatencyMs: 5,
    ...overrides,
  };
}

function fullSuccessResult(productKey: string, source: string): MarketSnapshotResult {
  const observations = [fakeObservation({ productKey, source, sourceItemId: `${productKey}-1` })];
  return {
    productKey,
    asOf: NOW.toISOString(),
    searchPlansUsed: [],
    coverageReport: baseCoverage({ perSource: [{ source, status: "success", observationCount: 1, latencyMs: 5, costClass: "free" }] }),
    observations,
    observationsPersisted: 1,
    persistenceError: null,
    identityPersisted: true,
    identityPersistenceError: null,
    fxRatesPersistedCount: null,
    fxPersistenceError: null,
    summary: { observationCount: 1, sourceDiversity: 1, currenciesObserved: ["CHF"], skippedForMissingRateCount: 0, staleRateCount: 0, normalizedCurrency: "CHF", normalizedRange: { medianCents: 18000, p25Cents: 17800, p75Cents: 18200, sampleSize: 1 } },
  };
}

function totalOutageResult(productKey: string): MarketSnapshotResult {
  return {
    productKey,
    asOf: NOW.toISOString(),
    searchPlansUsed: [],
    coverageReport: baseCoverage({
      sourcesSucceeded: 0,
      sourcesFailed: 1,
      perSource: [{ source: "ebay", status: "error", observationCount: 0, latencyMs: 5, costClass: "free" }],
      observationsReturned: 0,
      observationsAfterCanonicalDedupe: 0,
      observationsUsableAfterFx: 0,
      observationsPersisted: 0,
    }),
    observations: [],
    observationsPersisted: 0,
    persistenceError: null,
    identityPersisted: true,
    identityPersistenceError: null,
    fxRatesPersistedCount: null,
    fxPersistenceError: null,
    summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, staleRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
  };
}

function noSafeQueryResult(productKey: string): MarketSnapshotResult {
  // Le conflit d'identité dur laisse `stripConflictedFields` sans champ dur exploitable -> aucun plan de requête exacte, aucune source interrogée.
  return {
    productKey,
    asOf: NOW.toISOString(),
    searchPlansUsed: [],
    coverageReport: baseCoverage({ sourcesQueried: 0, sourcesSucceeded: 0, sourcesFailed: 0, perSource: [], observationsReturned: 0, observationsAfterCanonicalDedupe: 0, observationsUsableAfterFx: 0, observationsPersisted: 0 }),
    observations: [],
    observationsPersisted: 0,
    persistenceError: null,
    identityPersisted: true,
    identityPersistenceError: null,
    fxRatesPersistedCount: null,
    fxPersistenceError: null,
    summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, staleRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
  };
}

function fakeOutput(snapshot: MarketSnapshotResult): { snapshot: MarketSnapshotResult; selectionPlan: SourceSelectionPlan } {
  return {
    snapshot,
    selectionPlan: {
      categorySlug: snapshot.coverageReport.categorySlug,
      eligibleSources: snapshot.coverageReport.perSource.map((s) => s.source),
      excludedByPolicy: [],
      excludedByMissingCredentials: [],
      excludedByIdentityWeakness: [],
      excludedByCostBudget: [],
      selectedSources: snapshot.coverageReport.perSource.map((s) => s.source),
      selectionOrder: snapshot.coverageReport.perSource.map((s) => s.source),
      entries: [],
      projectedCostClasses: {},
      budgetStateAfter: initialRefreshBudgetState(NOW.getTime()),
    },
  };
}

function researchTargetRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
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

function seedProductIdentity(db: InstanceType<typeof FakeSupabase>, rows: { productKey: string; categorySlug: string; identifiers: Record<string, string> }[]) {
  db.seed(
    "market_products",
    rows.map((r) => ({ product_key: r.productKey, category_slug: r.categorySlug, last_seen_at: NOW.toISOString() })),
  );
  const identifierRows: Record<string, unknown>[] = [];
  for (const r of rows) {
    let i = 0;
    for (const [field, value] of Object.entries(r.identifiers)) {
      identifierRows.push({ product_key: r.productKey, field, value, source: `fixture-${i++}`, confidence: 0.9, observed_at: "2026-09-01T00:00:00.000Z" });
    }
  }
  db.seed("market_product_identifiers", identifierRows);
}

beforeEach(() => {
  vi.mocked(takeProductSnapshot).mockReset();
});

describe("runDueMarketRefreshBatch — simulation E2E concurrente", () => {
  it("deux workers concurrents traitent 3 cibles dues (succès complet / panne totale / conflit d'identité dur) sans jamais dupliquer un rafraîchissement", async () => {
    const db = new FakeSupabase();
    installSimulatedResearchTargetLeaseRpcs(db, () => NOW);

    seedProductIdentity(db, [
      { productKey: "lego:10300", categorySlug: "lego", identifiers: { bricklinkNo: "10300" } },
      { productKey: "apple:iphone-13-outage", categorySlug: "apple", identifiers: { asin: "B0XOUTAGE" } },
      { productKey: "apple:iphone-13-conflict", categorySlug: "apple", identifiers: {} }, // rempli avec un conflit dur ci-dessous.
    ]);
    // Conflit dur : deux UPC différents pour la même cible, jamais résolu.
    db.seed("market_product_identifiers", [
      ...db.table("market_product_identifiers"),
      { product_key: "apple:iphone-13-conflict", field: "upc", value: "111111111111", source: "ebay", confidence: 0.9, observed_at: "2026-09-01T00:00:00.000Z" },
      { product_key: "apple:iphone-13-conflict", field: "upc", value: "222222222222", source: "google_shopping", confidence: 0.8, observed_at: "2026-09-02T00:00:00.000Z" },
    ]);

    db.seed("research_targets", [
      researchTargetRow({ id: 1, product_key: "lego:10300", priority: 90, next_refresh_at: null }),
      researchTargetRow({ id: 2, product_key: "apple:iphone-13-outage", priority: 70, next_refresh_at: null }),
      researchTargetRow({ id: 3, product_key: "apple:iphone-13-conflict", priority: 50, next_refresh_at: null }),
    ]);

    const callsByProductKey: Record<string, number> = {};
    vi.mocked(takeProductSnapshot).mockImplementation(async (input) => {
      const productKey = input.identity.productKey;
      callsByProductKey[productKey] = (callsByProductKey[productKey] ?? 0) + 1;
      if (productKey === "lego:10300") return fakeOutput(fullSuccessResult(productKey, "bricklink"));
      if (productKey === "apple:iphone-13-outage") return fakeOutput(totalOutageResult(productKey));
      return fakeOutput(noSafeQueryResult(productKey));
    });

    const [summaryA, summaryB] = await Promise.all([
      runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-a", now: () => NOW }),
      runDueMarketRefreshBatch({ db: db as never, leaseOwner: "worker-b", now: () => NOW }),
    ]);

    // Chaque cible traitée EXACTEMENT une fois au total, jamais deux fois par deux workers différents.
    expect(callsByProductKey["lego:10300"]).toBe(1);
    expect(callsByProductKey["apple:iphone-13-outage"]).toBe(1);
    expect(callsByProductKey["apple:iphone-13-conflict"]).toBe(1);

    const totalClaimed = summaryA.claimed + summaryB.claimed;
    const totalSucceeded = summaryA.succeeded + summaryB.succeeded;
    const totalFailed = summaryA.failed + summaryB.failed;
    expect(totalClaimed).toBe(3);
    expect(totalSucceeded).toBe(1);
    expect(totalFailed).toBe(2);

    // Aucun bail actif restant, aucune cible bloquée après le run.
    expect(db.table("research_targets").every((r) => r.claimed_by === null)).toBe(true);

    const rows = db.table("research_targets") as Record<string, unknown>[];
    const legoRow = rows.find((r) => r.product_key === "lego:10300")!;
    const outageRow = rows.find((r) => r.product_key === "apple:iphone-13-outage")!;
    const conflictRow = rows.find((r) => r.product_key === "apple:iphone-13-conflict")!;

    // La cible réussie obtient un délai NORMAL (planification de succès) ; les deux cibles échouées obtiennent un délai de nouvel essai — jamais confondus.
    expect(legoRow.consecutive_failures).toBe(0);
    expect(outageRow.consecutive_failures).toBe(1);
    expect(conflictRow.consecutive_failures).toBe(1);
    expect(Date.parse(legoRow.next_refresh_at as string)).toBeGreaterThan(NOW.getTime());
    expect(Date.parse(outageRow.next_refresh_at as string)).toBeGreaterThan(NOW.getTime());
    expect(Date.parse(conflictRow.next_refresh_at as string)).toBeGreaterThan(NOW.getTime());

    // Jamais une vente fabriquée à partir d'une absence d'observation.
    expect(db.table("listing_lifecycles").every((r) => r.confirmed_sold_at === null || r.confirmed_sold_at === undefined)).toBe(true);

    // La cible réussie a bien accumulé une ligne de cycle de vie d'annonce et un résumé de cycle — UNE SEULE fois (pas de doublon lié à la concurrence).
    expect(db.table("listing_lifecycles").filter((r) => r.product_key === "lego:10300")).toHaveLength(1);
    expect(db.table("market_snapshot_summaries").filter((r) => r.product_key === "lego:10300")).toHaveLength(1);
  });
});
