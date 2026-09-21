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
