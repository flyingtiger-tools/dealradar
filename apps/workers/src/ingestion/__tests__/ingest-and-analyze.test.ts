import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dealradar/ingestion", async () => {
  const actual = await vi.importActual<typeof import("@dealradar/ingestion")>("@dealradar/ingestion");
  return {
    ...actual,
    runIngestion: vi.fn(),
    extractListing: vi.fn(),
    analyzeListing: vi.fn(),
  };
});

import { runIngestion, extractListing, analyzeListing } from "@dealradar/ingestion";
import { ingestAndAnalyze } from "../ingest-and-analyze";

const LISTING_ID = "listing-1";

/** Simule uniquement `.from("listings").select(...).eq("id", …).maybeSingle()` — le seul accès DB direct de `ingestAndAnalyze` (le reste passe par les fonctions mockées de `@dealradar/ingestion`). */
function fakeSupabase(row: Record<string, unknown> | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: row, error: null })),
        })),
      })),
    })),
  };
}

beforeEach(() => {
  delete process.env.AI_PROVIDER;
  vi.mocked(runIngestion).mockReset();
  vi.mocked(extractListing).mockReset().mockResolvedValue({ extracted: false, source: null, warnings: [] });
  vi.mocked(analyzeListing).mockReset().mockResolvedValue({ analyzed: true, result: null });
});

describe("ingestAndAnalyze — assemblage des coûts", () => {
  it("transmet le coût de livraison réel de l'annonce (shipping_cost_cents) à analyzeListing", async () => {
    vi.mocked(runIngestion).mockResolvedValue({
      runId: "run-1",
      fetched: 1,
      inserted: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      listingIds: [LISTING_ID],
    });
    const supabase = fakeSupabase({ price_cents: 84999, shipping_cost_cents: 1500 });

    await ingestAndAnalyze({
      supabase: supabase as never,
      connector: {} as never,
      sourceSlug: "ebay",
      categorySlug: "lego",
      q: "lego star wars",
    });

    expect(analyzeListing).toHaveBeenCalledTimes(1);
    const call = vi.mocked(analyzeListing).mock.calls[0]![0];
    expect(call.costs.purchasePriceCents).toBe(84999);
    expect(call.costs.shippingCostCents).toBe(1500);
  });

  it("retombe sur 0 quand shipping_cost_cents est null (annonce sans coût de livraison connu)", async () => {
    vi.mocked(runIngestion).mockResolvedValue({
      runId: "run-1",
      fetched: 1,
      inserted: 1,
      updated: 0,
      skipped: 0,
      failed: 0,
      listingIds: [LISTING_ID],
    });
    const supabase = fakeSupabase({ price_cents: 84999, shipping_cost_cents: null });

    await ingestAndAnalyze({
      supabase: supabase as never,
      connector: {} as never,
      sourceSlug: "ebay",
      categorySlug: "lego",
      q: "lego star wars",
    });

    const call = vi.mocked(analyzeListing).mock.calls[0]![0];
    expect(call.costs.shippingCostCents).toBe(0);
  });
});
