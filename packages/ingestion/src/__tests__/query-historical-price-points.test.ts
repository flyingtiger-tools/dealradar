import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { queryHistoricalPricePoints } from "../query-historical-price-points";

describe("queryHistoricalPricePoints", () => {
  it("renvoie les points dans la fenêtre, triés du plus ancien au plus récent", async () => {
    const db = new FakeSupabase();
    db.seed("market_observations", [
      { product_key: "lego:10300", observed_at: "2026-09-15T00:00:00.000Z", price_cents: 18000, source: "ebay" },
      { product_key: "lego:10300", observed_at: "2026-09-01T00:00:00.000Z", price_cents: 18500, source: "bricklink" },
    ]);

    const points = await queryHistoricalPricePoints(db as never, "lego:10300", { sinceIso: "2026-08-01T00:00:00.000Z" });
    expect(points.map((p) => p.observedAt)).toEqual(["2026-09-01T00:00:00.000Z", "2026-09-15T00:00:00.000Z"]);
  });

  it("exclut les points antérieurs à sinceIso", async () => {
    const db = new FakeSupabase();
    db.seed("market_observations", [
      { product_key: "lego:10300", observed_at: "2026-01-01T00:00:00.000Z", price_cents: 20000, source: "ebay" },
      { product_key: "lego:10300", observed_at: "2026-09-15T00:00:00.000Z", price_cents: 18000, source: "ebay" },
    ]);

    const points = await queryHistoricalPricePoints(db as never, "lego:10300", { sinceIso: "2026-08-01T00:00:00.000Z" });
    expect(points).toHaveLength(1);
    expect(points[0]?.priceCents).toBe(18000);
  });

  it("scopé par product_key — n'inclut jamais un AUTRE produit", async () => {
    const db = new FakeSupabase();
    db.seed("market_observations", [
      { product_key: "apple:iphone-13", observed_at: "2026-09-15T00:00:00.000Z", price_cents: 50000, source: "keepa" },
      { product_key: "lego:10300", observed_at: "2026-09-15T00:00:00.000Z", price_cents: 18000, source: "ebay" },
    ]);

    const points = await queryHistoricalPricePoints(db as never, "lego:10300", { sinceIso: "2026-01-01T00:00:00.000Z" });
    expect(points).toHaveLength(1);
    expect(points[0]?.source).toBe("ebay");
  });
});
