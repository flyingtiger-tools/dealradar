import { describe, expect, it } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import { FakeSupabase } from "./fake-supabase";
import { persistMarketSnapshotSummary } from "../persist-market-snapshot-summary";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "ebay",
    sourceItemId: "1",
    sourceUrl: null,
    observedAt: "2026-09-21T00:00:00.000Z",
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
    marketplace: "ebay",
    evidenceType: "activeListings",
    evidenceTier: "D",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

describe("persistMarketSnapshotSummary", () => {
  it("insère un résumé avec low/fair/high dérivés du MedianRangeSignal", async () => {
    const db = new FakeSupabase();
    const result = await persistMarketSnapshotSummary({
      supabase: db as never,
      productKey: "lego:10300",
      asOf: "2026-09-21T00:00:00.000Z",
      currency: "CHF",
      normalizedRange: { medianCents: 18000, p25Cents: 17000, p75Cents: 19000, sampleSize: 3 },
      observations: [fakeObservation({ evidenceTier: "B" }), fakeObservation({ source: "bricklink", evidenceTier: "D" })],
      historicalPoints: [],
      activeSupplyCount: 2,
      coverageScore: 80,
    });

    expect(result.outcome).toBe("inserted");
    const row = db.table("market_snapshot_summaries")[0] as Record<string, unknown>;
    expect(row.low_cents).toBe(17000);
    expect(row.fair_cents).toBe(18000);
    expect(row.high_cents).toBe(19000);
    expect(row.strongest_tier).toBe("B"); // le palier le plus fort des deux observations, jamais le premier venu.
    expect(row.source_count).toBe(2);
  });

  it("aucune recommandation utilisateur n'est jamais portée par la ligne persistée", async () => {
    const db = new FakeSupabase();
    await persistMarketSnapshotSummary({
      supabase: db as never,
      productKey: "lego:10300",
      asOf: "2026-09-21T00:00:00.000Z",
      currency: "CHF",
      normalizedRange: null,
      observations: [],
      historicalPoints: [],
      activeSupplyCount: 0,
      coverageScore: null,
    });
    const row = db.table("market_snapshot_summaries")[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("recommendation");
    expect(row).not.toHaveProperty("decision");
    expect(row).not.toHaveProperty("verdict");
  });

  it("normalizedRange null -> low/fair/high null, jamais une valeur fabriquée", async () => {
    const db = new FakeSupabase();
    await persistMarketSnapshotSummary({
      supabase: db as never,
      productKey: "lego:10300",
      asOf: "2026-09-21T00:00:00.000Z",
      currency: "CHF",
      normalizedRange: null,
      observations: [],
      historicalPoints: [],
      activeSupplyCount: 0,
      coverageScore: null,
    });
    const row = db.table("market_snapshot_summaries")[0] as Record<string, unknown>;
    expect(row.low_cents).toBeNull();
    expect(row.fair_cents).toBeNull();
    expect(row.high_cents).toBeNull();
  });

  it("idempotent sur cycle_key : rejouer le même cycle (même productKey+asOf) met à jour en place, jamais un doublon", async () => {
    const db = new FakeSupabase();
    const input = {
      supabase: db as never,
      productKey: "lego:10300",
      asOf: "2026-09-21T00:00:00.000Z",
      currency: "CHF",
      normalizedRange: { medianCents: 18000, p25Cents: 17000, p75Cents: 19000, sampleSize: 1 },
      observations: [fakeObservation()],
      historicalPoints: [],
      activeSupplyCount: 1,
      coverageScore: 100,
    };
    const first = await persistMarketSnapshotSummary(input);
    const second = await persistMarketSnapshotSummary(input);

    expect(first.outcome).toBe("inserted");
    expect(second.outcome).toBe("updated");
    expect(db.table("market_snapshot_summaries")).toHaveLength(1);
  });

  it("calcule la volatilité/tendance depuis l'historique fourni, jamais seulement le cycle courant", async () => {
    const db = new FakeSupabase();
    const historicalPoints = [
      { observedAt: "2026-08-01T00:00:00.000Z", priceCents: 20000, source: "ebay" },
      { observedAt: "2026-08-15T00:00:00.000Z", priceCents: 19000, source: "ebay" },
      { observedAt: "2026-09-01T00:00:00.000Z", priceCents: 18500, source: "ebay" },
      { observedAt: "2026-09-15T00:00:00.000Z", priceCents: 18000, source: "ebay" },
    ];
    await persistMarketSnapshotSummary({
      supabase: db as never,
      productKey: "lego:10300",
      asOf: "2026-09-21T00:00:00.000Z",
      currency: "CHF",
      normalizedRange: null,
      observations: [],
      historicalPoints,
      activeSupplyCount: 0,
      coverageScore: null,
    });
    const row = db.table("market_snapshot_summaries")[0] as { volatility: { sampleSize: number } | null };
    expect(row.volatility?.sampleSize).toBe(4);
  });
});
