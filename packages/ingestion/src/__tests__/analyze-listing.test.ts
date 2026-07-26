import { describe, expect, it } from "vitest";
import { analyzeListing } from "../analyze-listing";
import { FakeSupabase } from "./fake-supabase";
import type { CostInputs } from "@dealradar/core";

const ASOF = "2026-07-26T00:00:00.000Z";

function costs(overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    purchasePriceCents: 40000,
    shippingCostCents: 1500,
    platformFeeRate: 0.12,
    refurbCostCents: 0,
    riskReserveRate: 0.05,
    ...overrides,
  };
}

function targetListing(overrides: Record<string, unknown> = {}) {
  return {
    id: "target-1",
    title: "LEGO Star Wars 75192",
    price_cents: 40000,
    currency: "CHF",
    condition: "good",
    attributes: { categorySlug: "lego", setNumber: "75192" },
    first_seen_at: "2026-07-01T00:00:00.000Z",
    status: "active",
    sources: { slug: "ebay" },
    ...overrides,
  };
}

function soldComparable(id: string, priceCents: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: "LEGO Star Wars 75192 vendu",
    price_cents: priceCents,
    currency: "CHF",
    condition: "good",
    attributes: { categorySlug: "lego", setNumber: "75192" },
    status: "sold",
    sold_at: "2026-06-01T00:00:00.000Z",
    sources: { slug: "ebay" },
    ...overrides,
  };
}

describe("analyzeListing", () => {
  it("retourne INSUFFICIENT_DATA sans comparables vendus (cas eBay seul, honnête)", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("listings", [targetListing()]);

    const outcome = await analyzeListing({ supabase: supabase as never, listingId: "target-1", costs: costs(), asOf: ASOF });

    expect(outcome.analyzed).toBe(true);
    expect(outcome.result?.decision).toBe("INSUFFICIENT_DATA");
    expect(supabase.table("intelligence_results")).toHaveLength(1);
    expect(supabase.table("listings")[0]!.processing_status).toBe("insufficient_data");
  });

  it("ne construit jamais d'entrée quand la catégorie ou la condition sont inconnues", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("listings", [targetListing({ attributes: {} })]);

    const outcome = await analyzeListing({ supabase: supabase as never, listingId: "target-1", costs: costs(), asOf: ASOF });

    expect(outcome.analyzed).toBe(false);
    expect(outcome.result).toBeNull();
    expect(supabase.table("intelligence_results")).toHaveLength(0);
    expect(supabase.table("listings")[0]!.processing_status).toBe("insufficient_data");
  });

  it("exclut un produit différent de la même catégorie du pré-filtrage DB", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("listings", [
      targetListing(),
      ...Array.from({ length: 5 }, (_, i) => soldComparable(`good-${i}`, 60000 + i * 500)),
      // Même catégorie (lego) mais un set différent — ne doit jamais être retenu.
      soldComparable("wrong-product", 5000, { attributes: { categorySlug: "lego", setNumber: "OTHER-SET" } }),
    ]);

    const outcome = await analyzeListing({ supabase: supabase as never, listingId: "target-1", costs: costs(), asOf: ASOF });

    expect(outcome.result?.comparables.matched.some((c) => c.id === "wrong-product")).toBe(false);
  });

  it("exclut une devise incompatible du pré-filtrage DB", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("listings", [
      targetListing(),
      ...Array.from({ length: 5 }, (_, i) => soldComparable(`good-${i}`, 60000 + i * 500)),
      soldComparable("wrong-currency", 60000, { currency: "EUR" }),
    ]);

    const outcome = await analyzeListing({ supabase: supabase as never, listingId: "target-1", costs: costs(), asOf: ASOF });

    expect(outcome.result?.comparables.matched.some((c) => c.id === "wrong-currency")).toBe(false);
  });

  it("recommande BUY avec un pool de comparables vendus solide et une bonne marge", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("listings", [
      targetListing({ price_cents: 40000 }),
      ...Array.from({ length: 6 }, (_, i) => soldComparable(`good-${i}`, 90000 + i * 500)),
    ]);

    const outcome = await analyzeListing({
      supabase: supabase as never,
      listingId: "target-1",
      costs: costs({ purchasePriceCents: 40000 }),
      asOf: ASOF,
    });

    expect(outcome.result?.decision).toBe("BUY");
    expect(supabase.table("listings")[0]!.processing_status).toBe("analyzed");
  });

  it("ne recommande jamais BUY à partir d'annonces actives seules (aucun comparable vendu de confiance)", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("listings", [
      targetListing({ price_cents: 100 }), // prix ridiculement bas, marge énorme si comptée
      // Des annonces actives, pas vendues, ne doivent jamais compter comme comparables.
      { ...soldComparable("active-1", 90000), status: "active", sold_at: null },
      { ...soldComparable("active-2", 91000), status: "active", sold_at: null },
    ]);

    const outcome = await analyzeListing({ supabase: supabase as never, listingId: "target-1", costs: costs({ purchasePriceCents: 100 }), asOf: ASOF });

    expect(outcome.result?.decision).not.toBe("BUY");
    expect(outcome.result?.decision).toBe("INSUFFICIENT_DATA");
  });
});
