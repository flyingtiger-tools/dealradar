import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MarketSource } from "@dealradar/connectors";
import { createCanonicalProductIdentity, mergeIdentityEvidence } from "@dealradar/core";

vi.mock("@dealradar/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dealradar/ingestion")>()),
  takeMarketSnapshot: vi.fn(),
}));

vi.mock("../../ingestion/market-source-factory", () => ({
  buildMarketSourcesFromEnv: vi.fn(() => ({ sources: [], diagnostics: [] })),
}));

const { takeMarketSnapshot } = await import("@dealradar/ingestion");
const { buildMarketSourcesFromEnv } = await import("../../ingestion/market-source-factory");
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

beforeEach(() => {
  vi.mocked(takeMarketSnapshot).mockReset();
  vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [], diagnostics: [] });
});

describe("takeProductSnapshot", () => {
  it("résout les sources disponibles pour la catégorie et délègue à takeMarketSnapshot", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("bricklink")], diagnostics: [{ name: "bricklink", enabled: true }] });
    vi.mocked(takeMarketSnapshot).mockResolvedValue({
      productKey: "lego:10300",
      asOf: ASOF,
      searchPlansUsed: [],
      coverageReport: { categorySlug: "lego", asOf: ASOF, sourcesQueried: 1, sourcesSucceeded: 1, sourcesFailed: 0, perSource: [], observationsReturned: 0, observationsAfterCanonicalDedupe: 0, observationsUsableAfterFx: 0, observationsPersisted: 0, medianLatencyMs: null },
      observationsPersisted: 0,
      persistenceError: null,
      identityPersisted: true,
      identityPersistenceError: null,
      fxRatesPersistedCount: null,
      fxPersistenceError: null,
      summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
    });

    const db = new FakeSupabase();
    const result = await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never });

    expect(takeMarketSnapshot).toHaveBeenCalledTimes(1);
    const call = vi.mocked(takeMarketSnapshot).mock.calls[0]![0];
    expect(call.sources.map((s) => s.source)).toEqual(["bricklink"]);
    expect(result.productKey).toBe("lego:10300");
  });

  it("aucune source disponible (credentials absentes) : délègue quand même à takeMarketSnapshot avec une liste vide, jamais une exception", async () => {
    vi.mocked(takeMarketSnapshot).mockResolvedValue({
      productKey: "lego:10300",
      asOf: ASOF,
      searchPlansUsed: [],
      coverageReport: { categorySlug: "lego", asOf: ASOF, sourcesQueried: 0, sourcesSucceeded: 0, sourcesFailed: 0, perSource: [], observationsReturned: 0, observationsAfterCanonicalDedupe: 0, observationsUsableAfterFx: 0, observationsPersisted: null, medianLatencyMs: null },
      observationsPersisted: null,
      persistenceError: null,
      identityPersisted: false,
      identityPersistenceError: null,
      fxRatesPersistedCount: null,
      fxPersistenceError: null,
      summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
    });

    const db = new FakeSupabase();
    await expect(takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never })).resolves.toBeDefined();

    const call = vi.mocked(takeMarketSnapshot).mock.calls[0]![0];
    expect(call.sources).toEqual([]);
  });

  it("transmet maxCostClass/maxSourceCount au routage par catégorie", async () => {
    vi.mocked(buildMarketSourcesFromEnv).mockReturnValue({ sources: [fakeMarketSource("ricardo")], diagnostics: [{ name: "ricardo", enabled: true }] });
    vi.mocked(takeMarketSnapshot).mockResolvedValue({
      productKey: "lego:10300",
      asOf: ASOF,
      searchPlansUsed: [],
      coverageReport: { categorySlug: "lego", asOf: ASOF, sourcesQueried: 0, sourcesSucceeded: 0, sourcesFailed: 0, perSource: [], observationsReturned: 0, observationsAfterCanonicalDedupe: 0, observationsUsableAfterFx: 0, observationsPersisted: null, medianLatencyMs: null },
      observationsPersisted: null,
      persistenceError: null,
      identityPersisted: false,
      identityPersistenceError: null,
      fxRatesPersistedCount: null,
      fxPersistenceError: null,
      summary: { observationCount: 0, sourceDiversity: 0, currenciesObserved: [], skippedForMissingRateCount: 0, normalizedCurrency: "CHF", normalizedRange: null },
    });

    const db = new FakeSupabase();
    await takeProductSnapshot({ identity: legoIdentity(), categorySlug: "lego", desiredCurrency: "CHF", db: db as never, maxCostClass: "cheap" });

    // ricardo = high_cost -> exclu par le plafond "cheap", jamais transmis à takeMarketSnapshot.
    const call = vi.mocked(takeMarketSnapshot).mock.calls[0]![0];
    expect(call.sources).toEqual([]);
  });
});
