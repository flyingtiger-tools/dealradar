import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-supabase";
import { ensureBenchmarkSource, runDatasetOnline } from "../supabase-runner";
import { cleanupBenchmarkRun } from "../cleanup";
import type { Dataset } from "../../dataset/schema";

const MINI_DATASET: Dataset = {
  categorySlug: "lego",
  provenance: "synthetic",
  items: [
    { raw: { itemId: "t-online-1", title: "LEGO Star Wars 75313 AT-AT", price: { value: "849.99", currency: "CHF" }, condition: "New" } },
  ],
  comparables: [
    {
      raw: { itemId: "t-online-comp-1", title: "LEGO Star Wars 75313 AT-AT vendu", price: { value: "800.00", currency: "CHF" }, condition: "New" },
      soldAt: "2026-06-01T00:00:00.000Z",
    },
  ],
};

describe("ensureBenchmarkSource", () => {
  it("crée la source benchmark une seule fois puis la réutilise", async () => {
    const supabase = new FakeSupabase();
    const first = await ensureBenchmarkSource(supabase as never);
    const second = await ensureBenchmarkSource(supabase as never);
    expect(first).toBe(second);
    expect(supabase.table("sources")).toHaveLength(1);
    expect((supabase.table("sources")[0] as { is_active: boolean }).is_active).toBe(false);
  });
});

describe("runDatasetOnline", () => {
  it("persiste les annonces et marque le pool de comparables comme vendu", async () => {
    const supabase = new FakeSupabase();
    const result = await runDatasetOnline(supabase as never, MINI_DATASET, { asOf: "2026-07-26T00:00:00.000Z" });

    expect(result.listingIds.length).toBeGreaterThan(0);
    const listings = supabase.table("listings") as Array<{ external_id: string; status: string }>;
    const comp = listings.find((l) => l.external_id === "t-online-comp-1");
    expect(comp?.status).toBe("sold");
    const main = listings.find((l) => l.external_id === "t-online-1");
    expect(main?.status).toBe("active");
  });
});

describe("cleanupBenchmarkRun", () => {
  it("supprime les annonces créées sous la source benchmark", async () => {
    const supabase = new FakeSupabase();
    await runDatasetOnline(supabase as never, MINI_DATASET, { asOf: "2026-07-26T00:00:00.000Z" });
    const before = supabase.table("listings").length;
    expect(before).toBeGreaterThan(0);

    const report = await cleanupBenchmarkRun(supabase as never, { runStartedAt: "2020-01-01T00:00:00.000Z" });

    expect(report.listingsDeleted).toBe(before);
    expect(supabase.table("listings")).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it("ne supprime jamais une annonce d'une autre source", async () => {
    const supabase = new FakeSupabase();
    supabase.seed("sources", [{ id: "ebay-source", slug: "ebay" }]);
    supabase.seed("listings", [{ id: "real-listing-1", source_id: "ebay-source", external_id: "real-1" }]);

    await runDatasetOnline(supabase as never, MINI_DATASET, { asOf: "2026-07-26T00:00:00.000Z" });
    await cleanupBenchmarkRun(supabase as never, { runStartedAt: "2020-01-01T00:00:00.000Z" });

    const remaining = supabase.table("listings") as Array<{ id: string }>;
    expect(remaining.some((l) => l.id === "real-listing-1")).toBe(true);
  });
});
