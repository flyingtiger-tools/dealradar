import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MarketSource } from "@dealradar/connectors";
import { createCanonicalProductIdentity, mergeIdentityEvidence, DEFAULT_REFRESH_BUDGET_LIMITS, initialRefreshBudgetState } from "@dealradar/core";

vi.mock("@dealradar/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dealradar/ingestion")>()),
  takeMarketSnapshot: vi.fn(),
}));

vi.mock("../../ingestion/market-source-factory", () => ({
  buildMarketSourcesFromEnv: vi.fn(() => ({ sources: [], diagnostics: [] })),
  computeEnvPresenceBySource: vi.fn(() => ({})),
}));

const { takeMarketSnapshot } = await import("@dealradar/ingestion");
const { buildMarketSourcesFromEnv, computeEnvPresenceBySource } = await import("../../ingestion/market-source-factory");
const { takeProductSnapshot } = await import("../take-product-snapshot");
const { FakeSupabase } = await import("./fake-supabase");

function fakeMarketSource(source: string): MarketSource {
  return {
    source,
    displayName: source,
    supportedCategorySlugs: "any",
    evidenceTypes: ["historicalPrices"],
    async search() {
      return { observations: [] };
    },
    async healthCheck() {
      return { status: "ok", checkedAt: "t", latencyMs: 1 };
    },
  };
}

const ASOF = "2026-09-21T00:00:00.000Z";

function legoIdentity() {
  return mergeIdentityEvidence(createCanonicalProductIdentity("lego", "lego:10300"), {
    source: "user_scan",
    confidence: 0.9,
    observedAt: ASOF,
    fields: { bricklinkNo: "10300" },
  }).identity;
}

function fakeSnapshotResult() {
  return {
    productKey: "lego:10300",
    asOf: ASOF,
    searchPlansUsed: [],
    coverageReport: { categorySlug: "lego", asOf: ASOF, sourcesQueried: 0, sourcesSucceeded: 0, sourcesFailed: 0, perSource: [], observationsReturned: 0, observationsAfterCanonicalDedupe: 0, observationsUsableAfterFx: 0, observationsPersisted: null, medianLatencyMs: null },
    observations: [],
    observationsPersisted: null,
    persistenceError: null,
    identityPersisted: false,
    identityPersistenceError: null,
    fxRatesPersistedCount: null,
    fxPersistenceError: null,
    summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, staleRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
  };
}

beforeEach(() => {
  vi.mocked(takeMarketSnapshot).mockReset();
  vi.mocked(takeMarketSnapshot).mockResolvedValue(fakeSnapshotResult());
  vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [], diagnostics: [] });
  vi.mocked(computeEnvPresenceBySource).mockReturnValue({});
});

describe("takeProductSnapshot", () => {
  it("résout les sources SÉLECTIONNÉES par le SourceSelectionPlan (prêtes + budget) et délègue à takeMarketSnapshot", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({
      bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true },
    });

    const db = new FakeSupabase();
    const { snapshot, selectionPlan } = await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never });

    expect(takeMarketSnapshot).toHaveBeenCalledTimes(1);
    const call = vi.mocked(takeMarketSnapshot).mock.calls[0]![0];
    expect(call.sources.map((s) => s.source)).toEqual(["bricklink"]);
    expect(snapshot.productKey).toBe("lego:10300");
    expect(selectionPlan.selectedSources).toEqual(["bricklink"]);
  });

  it("aucune source prête (credentials absentes) : délègue quand même à takeMarketSnapshot avec une liste vide, jamais une exception", async () => {
    const db = new FakeSupabase();
    const { selectionPlan } = await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never });

    const call = vi.mocked(takeMarketSnapshot).mock.calls[0]![0];
    expect(call.sources).toEqual([]);
    expect(selectionPlan.selectedSources).toEqual([]);
  });

  it("un budget déjà épuisé (maxSourcesPerTarget: 0) exclut TOUTES les sources, même prêtes", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({
      bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true },
    });

    const db = new FakeSupabase();
    const { selectionPlan } = await takeProductSnapshot({
      identity: legoIdentity(),
      categorySlug: "lego",
      desiredCurrency: "CHF",
      db: db as never,
      budgetState: initialRefreshBudgetState(Date.now()),
      budgetLimits: { ...DEFAULT_REFRESH_BUDGET_LIMITS, maxSourcesPerTarget: 0 },
    });

    expect(selectionPlan.selectedSources).toEqual([]);
    expect(selectionPlan.excludedByCostBudget).toContain("bricklink");
    const call = vi.mocked(takeMarketSnapshot).mock.calls[0]![0];
    expect(call.sources).toEqual([]);
  });

  describe("santé par source (LOT 'Product History UX + Source Health + Interactive Cancellation + Beta Readiness', section 4/5)", () => {
    it("une source déjà marquée unhealthy est repositionnée après une source healthy, jamais exclue pour ce seul motif", async () => {
      vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("keepa"), fakeMarketSource("google_shopping")], diagnostics: [] });
      vi.mocked(computeEnvPresenceBySource).mockReturnValue({
        keepa: { KEEPA_API_KEY: true },
        google_shopping: { SERPAPI_KEY: true },
      });
      const db = new FakeSupabase();
      db.seed("source_health_state", [
        { source: "keepa", enabled: true, last_success_at: null, last_failure_at: "2026-09-20T00:00:00.000Z", last_failure_reason_class: "network", recent_latencies_ms: [], requests_used: 3, total_estimated_cost_usd: 0, consecutive_failures: 3, aborted_count: 0, timeout_count: 0, observations_returned_total: 0 },
      ]);

      const { selectionPlan } = await takeProductSnapshot({ identity: mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone"), { source: "user_scan", confidence: 0.9, observedAt: ASOF, fields: {} }).identity, categorySlug: "apple", desiredCurrency: "CHF", db: db as never });

      expect(selectionPlan.selectedSources).toContain("keepa"); // jamais exclue.
      expect(selectionPlan.deprioritizedForHealth).toContain("keepa");
    });

    it("après un instantané, l'état de santé est mis à jour ET persisté pour chaque source interrogée", async () => {
      vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [] });
      vi.mocked(computeEnvPresenceBySource).mockReturnValue({
        bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true },
      });
      vi.mocked(takeMarketSnapshot).mockResolvedValue({
        ...fakeSnapshotResult(),
        coverageReport: { ...fakeSnapshotResult().coverageReport, perSource: [{ source: "bricklink", status: "success", observationCount: 3, latencyMs: 50, costClass: "free" }] },
      });
      const db = new FakeSupabase();

      await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never });

      const rows = db.table("source_health_state") as { source: string; requests_used: number; observations_returned_total: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source).toBe("bricklink");
      expect(rows[0]?.requests_used).toBe(1);
      expect(rows[0]?.observations_returned_total).toBe(3);
    });

    it("status 'aborted' dans coverageReport ne dégrade JAMAIS la santé persistée", async () => {
      vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [] });
      vi.mocked(computeEnvPresenceBySource).mockReturnValue({
        bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true },
      });
      vi.mocked(takeMarketSnapshot).mockResolvedValue({
        ...fakeSnapshotResult(),
        coverageReport: { ...fakeSnapshotResult().coverageReport, perSource: [{ source: "bricklink", status: "aborted", observationCount: 0, latencyMs: 10, costClass: "free" }] },
      });
      const db = new FakeSupabase();

      await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never });

      const rows = db.table("source_health_state") as { consecutive_failures: number; aborted_count: number }[];
      expect(rows[0]?.consecutive_failures).toBe(0);
      expect(rows[0]?.aborted_count).toBe(1);
    });

    it("panne de lecture/écriture de santé (table absente) n'empêche JAMAIS l'instantané de se terminer", async () => {
      vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [] });
      vi.mocked(computeEnvPresenceBySource).mockReturnValue({
        bricklink: { BRICKLINK_CONSUMER_KEY: true, BRICKLINK_CONSUMER_SECRET: true, BRICKLINK_TOKEN_VALUE: true, BRICKLINK_TOKEN_SECRET: true },
      });
      const db = new FakeSupabase();
      vi.spyOn(db, "from").mockImplementation(() => {
        throw new Error("panne simulée de lecture de santé");
      });

      const result = await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never });

      expect(result.snapshot.productKey).toBe("lego:10300");
    });
  });

  it("ricardo (verrouillé par politique) n'est jamais sélectionné même avec ses credentials présentes", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("ricardo")], diagnostics: [] });
    vi.mocked(computeEnvPresenceBySource).mockReturnValue({ ricardo: {} });

    const db = new FakeSupabase();
    const { selectionPlan } = await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never });

    expect(selectionPlan.selectedSources).not.toContain("ricardo");
    expect(selectionPlan.excludedByPolicy).toContain("ricardo");
    const call = vi.mocked(takeMarketSnapshot).mock.calls[0]![0];
    expect(call.sources).toEqual([]);
  });
});
