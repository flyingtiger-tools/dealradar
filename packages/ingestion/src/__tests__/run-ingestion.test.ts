import { describe, expect, it } from "vitest";
import { runIngestion } from "../run-ingestion";
import { FakeSupabase } from "./fake-supabase";
import type { MarketplaceConnector, NormalizedListing, SearchResult } from "@dealradar/connectors";

function normalizedListing(externalId: string, overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    meta: {
      source: "ebay",
      externalId,
      originalUrl: `https://www.ebay.com/itm/${externalId}`,
      collectedAt: "2026-07-26T00:00:00.000Z",
    },
    title: `LEGO Star Wars ${externalId}`,
    price: { amountCents: 10000, currency: "CHF" },
    shippingCostCents: null,
    condition: "new",
    categorySlug: "lego",
    attributes: {},
    location: { country: null, postalCode: null, text: null },
    images: [],
    seller: { externalId: null, username: null, feedbackScore: null, feedbackPercentage: null },
    postedAt: null,
    ...overrides,
  };
}

function fakeConnector(pages: SearchResult[]): MarketplaceConnector {
  let call = 0;
  return {
    source: "ebay",
    capabilities: ["search", "itemDetails"],
    async search() {
      const page = pages[Math.min(call, pages.length - 1)]!;
      call += 1;
      return page;
    },
    async getItem() {
      return null;
    },
    async healthCheck() {
      return { status: "ok", checkedAt: new Date().toISOString(), latencyMs: 1 };
    },
  };
}

function seedSource(supabase: FakeSupabase): void {
  supabase.seed("sources", [{ id: "source-ebay", slug: "ebay" }]);
}

describe("runIngestion", () => {
  it("insère les annonces d'une page unique et complète le run", async () => {
    const supabase = new FakeSupabase();
    seedSource(supabase);
    const connector = fakeConnector([
      { listings: [normalizedListing("1"), normalizedListing("2")], total: 2, offset: 0, limit: 50, hasMore: false },
    ]);

    const summary = await runIngestion({ supabase: supabase as never, connector, sourceSlug: "ebay", categorySlug: "lego", q: "lego" });

    expect(summary.fetched).toBe(2);
    expect(summary.inserted).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.listingIds).toHaveLength(2);
    expect(supabase.table("ingestion_runs")[0]!.status).toBe("completed");
  });

  it("pagine tant que hasMore est vrai", async () => {
    const supabase = new FakeSupabase();
    seedSource(supabase);
    const connector = fakeConnector([
      { listings: [normalizedListing("1")], total: 2, offset: 0, limit: 1, hasMore: true },
      { listings: [normalizedListing("2")], total: 2, offset: 1, limit: 1, hasMore: false },
    ]);

    const summary = await runIngestion({ supabase: supabase as never, connector, sourceSlug: "ebay", categorySlug: "lego", q: "lego", pageSize: 1 });

    expect(summary.fetched).toBe(2);
    expect(summary.inserted).toBe(2);
  });

  it("rerun idempotent : la deuxième exécution ne réinsère rien", async () => {
    const supabase = new FakeSupabase();
    seedSource(supabase);
    const page: SearchResult = {
      listings: [normalizedListing("1"), normalizedListing("2")],
      total: 2,
      offset: 0,
      limit: 50,
      hasMore: false,
    };

    await runIngestion({ supabase: supabase as never, connector: fakeConnector([page]), sourceSlug: "ebay", categorySlug: "lego", q: "lego" });
    const second = await runIngestion({ supabase: supabase as never, connector: fakeConnector([page]), sourceSlug: "ebay", categorySlug: "lego", q: "lego" });

    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(2);
    expect(supabase.table("listings")).toHaveLength(2);
  });

  it("continue le traitement d'une page après l'échec d'un item isolé", async () => {
    const supabase = new FakeSupabase();
    seedSource(supabase);
    const badListing = { ...normalizedListing("bad"), price: undefined } as unknown as NormalizedListing;
    const connector = fakeConnector([
      { listings: [normalizedListing("1"), badListing, normalizedListing("2")], total: 3, offset: 0, limit: 50, hasMore: false },
    ]);

    const summary = await runIngestion({ supabase: supabase as never, connector, sourceSlug: "ebay", categorySlug: "lego", q: "lego" });

    expect(summary.fetched).toBe(3);
    expect(summary.inserted).toBe(2);
    expect(summary.failed).toBe(1);
    expect(supabase.table("ingestion_errors")).toHaveLength(1);
  });

  it("refuse de démarrer un run identique déjà en cours", async () => {
    const supabase = new FakeSupabase();
    seedSource(supabase);
    supabase.seed("ingestion_runs", [
      { id: "existing-run", source_id: "source-ebay", category_slug: "lego", query_text: "lego", status: "running" },
    ]);
    const connector = fakeConnector([{ listings: [], total: 0, offset: 0, limit: 50, hasMore: false }]);

    await expect(
      runIngestion({ supabase: supabase as never, connector, sourceSlug: "ebay", categorySlug: "lego", q: "lego" }),
    ).rejects.toThrow(/déjà en cours/);
  });

  it("marque le run comme échoué si le connecteur lève une erreur", async () => {
    const supabase = new FakeSupabase();
    seedSource(supabase);
    const connector: MarketplaceConnector = {
      source: "ebay",
      capabilities: ["search", "itemDetails"],
      async search() {
        throw new Error("panne réseau simulée");
      },
      async getItem() {
        return null;
      },
      async healthCheck() {
        return { status: "down", checkedAt: new Date().toISOString(), latencyMs: null };
      },
    };

    await expect(
      runIngestion({ supabase: supabase as never, connector, sourceSlug: "ebay", categorySlug: "lego", q: "lego" }),
    ).rejects.toThrow("panne réseau simulée");
    expect(supabase.table("ingestion_runs")[0]!.status).toBe("failed");
  });
});
