import { describe, expect, it, vi } from "vitest";
import { extractListing } from "../extract-listing";
import { FakeSupabase } from "./fake-supabase";
import type { AIProvider } from "@dealradar/ai";

function seedListing(supabase: FakeSupabase, overrides: Record<string, unknown> = {}): string {
  const id = "listing-1";
  supabase.seed("listings", [
    {
      id,
      title: "iPhone 13 Pro Max 256GB",
      description: null,
      condition: null,
      attributes: { categorySlug: "apple" },
      ...overrides,
    },
  ]);
  return id;
}

describe("extractListing", () => {
  it("enrichit attributes/condition à partir du déterministe seul, sans provider configuré", async () => {
    const supabase = new FakeSupabase();
    const id = seedListing(supabase);

    const outcome = await extractListing({ supabase: supabase as never, listingId: id });

    expect(outcome.extracted).toBe(true);
    expect(outcome.source).toBe("deterministic");
    const row = supabase.table("listings")[0] as { attributes: Record<string, unknown>; processing_status: string };
    expect(row.attributes.storageGb).toBe(256);
    expect(row.processing_status).toBe("normalized");
  });

  it("ne modifie jamais une catégorie déjà connue et retourne extracted=false sans catégorie", async () => {
    const supabase = new FakeSupabase();
    const id = seedListing(supabase, { attributes: {} });

    const outcome = await extractListing({ supabase: supabase as never, listingId: id });
    expect(outcome.extracted).toBe(false);
  });

  it("ne remplace jamais une condition déjà connue", async () => {
    const supabase = new FakeSupabase();
    const id = seedListing(supabase, { condition: "good" });

    await extractListing({ supabase: supabase as never, listingId: id });
    const row = supabase.table("listings")[0] as { condition: string };
    expect(row.condition).toBe("good");
  });

  it("appelle le provider IA quand configuré et le déterministe est insuffisant", async () => {
    const supabase = new FakeSupabase();
    const id = seedListing(supabase, { title: "iPhone en excellent état", attributes: { categorySlug: "apple" } });

    const extract = vi.fn(async () => ({
      raw: { attributes: { storageGb: 128 }, confidence: { storageGb: 0.9 } },
      usage: { inputUnits: 10, outputUnits: 10 },
    }));
    const provider: AIProvider = { name: "openai", model: "gpt-4o-mini", extract };

    const outcome = await extractListing({ supabase: supabase as never, listingId: id, provider });
    expect(outcome.source).toBe("ai");
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("inclut les images de listing_media dans l'appel au moteur d'extraction", async () => {
    const supabase = new FakeSupabase();
    const id = seedListing(supabase, { title: "iPhone en excellent état", attributes: { categorySlug: "apple" } });
    supabase.seed("listing_media", [
      { listing_id: id, source_url: "https://i.ebayimg.com/1.jpg", position: 0, content_hash: null },
    ]);

    const extract = vi.fn(async (request) => {
      expect(request.images).toHaveLength(1);
      return { raw: {}, usage: { inputUnits: 1, outputUnits: 1 } };
    });
    const provider: AIProvider = { name: "openai", model: "gpt-4o-mini", extract };

    await extractListing({
      supabase: supabase as never,
      listingId: id,
      provider,
      imageDomainAllowlist: ["ebayimg.com"],
    });
  });

  it("dégrade gracieusement sans planter si l'annonce est introuvable", async () => {
    const supabase = new FakeSupabase();
    await expect(extractListing({ supabase: supabase as never, listingId: "missing" })).rejects.toThrow(/introuvable/);
  });
});
