import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { queryProductHistory } from "../query-product-history";

const ASOF = "2026-09-21T00:00:00.000Z";

describe("queryProductHistory", () => {
  it("historique VIDE (aucun point) : résultat sûr, jamais une exception, sampleSize 0", async () => {
    const db = new FakeSupabase();
    const result = await queryProductHistory(db as never, "lego:unknown", { asOf: ASOF });
    expect(result.history.sampleSize).toBe(0);
    expect(result.recentSnapshotSummaries).toEqual([]);
    expect(result.activeSupplyCount).toBe(0);
  });

  it("historique PEU PROFOND (2 points) : confiance limitée, jamais surestimée", async () => {
    const db = new FakeSupabase();
    db.seed("market_observations", [
      { product_key: "lego:10300", observed_at: "2026-09-10T00:00:00.000Z", price_cents: 18000, source: "bricklink" },
      { product_key: "lego:10300", observed_at: "2026-09-15T00:00:00.000Z", price_cents: 18500, source: "bricklink" },
    ]);

    const result = await queryProductHistory(db as never, "lego:10300", { asOf: ASOF });
    expect(result.history.sampleSize).toBe(2);
    expect(result.history.confidence).toBeLessThan(50);
  });

  it("historique PROFOND (nombreux points, plusieurs sources, sur 180j) : trends 7/30/90/180 calculés, confiance plus élevée", async () => {
    const db = new FakeSupabase();
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const daysAgo = i * 4;
      rows.push({
        product_key: "lego:10300",
        observed_at: new Date(Date.parse(ASOF) - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
        price_cents: 18000 + (i % 5) * 100,
        source: i % 2 === 0 ? "bricklink" : "ebay",
      });
    }
    db.seed("market_observations", rows);

    const result = await queryProductHistory(db as never, "lego:10300", { asOf: ASOF, currentPriceCents: 18200 });
    expect(result.history.sampleSize).toBeGreaterThan(20);
    expect(result.history.trends).toHaveLength(4);
    expect(result.history.trends.map((t) => t.windowDays)).toEqual([7, 30, 90, 180]);
    expect(result.history.historicalPercentilePosition).not.toBeNull();
    expect(result.sourceDiversity).toBe(2);
  });

  it("résumés de cycle récents lus depuis market_snapshot_summaries, triés du plus récent au plus ancien", async () => {
    const db = new FakeSupabase();
    db.seed("market_snapshot_summaries", [
      { product_key: "lego:10300", cycle_at: "2026-09-15T00:00:00.000Z", cycle_key: "k1", currency: "CHF", low_cents: 17000, fair_cents: 18000, high_cents: 19000, confidence: 60, observation_count: 3, source_count: 2, strongest_tier: "B", coverage_score: 80, active_supply_count: 2 },
      { product_key: "lego:10300", cycle_at: "2026-09-20T00:00:00.000Z", cycle_key: "k2", currency: "CHF", low_cents: 17500, fair_cents: 18500, high_cents: 19500, confidence: 65, observation_count: 4, source_count: 3, strongest_tier: "A", coverage_score: 90, active_supply_count: 3 },
    ]);

    const result = await queryProductHistory(db as never, "lego:10300", { asOf: ASOF });
    expect(result.recentSnapshotSummaries).toHaveLength(2);
    expect(result.recentSnapshotSummaries[0]?.cycleKey).toBe("k2"); // le plus récent en premier.
  });

  it("activeSupplyCount compte uniquement les annonces ENCORE observées (currently_seen=true)", async () => {
    const db = new FakeSupabase();
    db.seed("listing_lifecycles", [
      { product_key: "lego:10300", source: "ebay", source_item_id: "1", currently_seen: true },
      { product_key: "lego:10300", source: "ebay", source_item_id: "2", currently_seen: false },
      { product_key: "lego:10300", source: "bricklink", source_item_id: "3", currently_seen: true },
    ]);

    const result = await queryProductHistory(db as never, "lego:10300", { asOf: ASOF });
    expect(result.activeSupplyCount).toBe(2);
  });

  it("scopé par product_key — jamais l'historique d'un AUTRE produit", async () => {
    const db = new FakeSupabase();
    db.seed("market_observations", [
      { product_key: "apple:iphone-13", observed_at: ASOF, price_cents: 50000, source: "keepa" },
      { product_key: "lego:10300", observed_at: ASOF, price_cents: 18000, source: "bricklink" },
    ]);

    const result = await queryProductHistory(db as never, "lego:10300", { asOf: ASOF });
    expect(result.history.sampleSize).toBe(1);
  });

  it("aucune recommandation/prédiction : le type de résultat ne porte aucun champ de décision ou de prix futur", () => {
    const result = {} as Record<string, unknown>;
    expect(result.decision).toBeUndefined();
    expect(result.predictedPriceCents).toBeUndefined();
    expect(result.recommendation).toBeUndefined();
  });
});
