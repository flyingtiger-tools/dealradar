import { describe, expect, it } from "vitest";
import { createSupabaseExtractionCache } from "../ai-cache-supabase";
import { FakeSupabase } from "./fake-supabase";
import type { ExtractedProduct } from "@dealradar/ai";

const META = { provider: "openai", model: "gpt-4o-mini", promptVersion: 1, schemaVersion: 1, deterministicVersion: 1 };

function fakeProduct(): ExtractedProduct {
  return {
    brand: { value: "Apple", confidence: 0.9, source: "ai" },
    model: null,
    reference: null,
    category: null,
    subcategory: null,
    condition: null,
    language: null,
    color: null,
    capacity: null,
    accessories: null,
    serialNumberDetected: { value: false, confidence: 0.8, source: "ai" },
    attributes: {},
  };
}

describe("createSupabaseExtractionCache", () => {
  it("retourne null pour une clé absente", async () => {
    const supabase = new FakeSupabase();
    const cache = createSupabaseExtractionCache(supabase as never, META);
    expect(await cache.get("missing")).toBeNull();
  });

  it("retourne l'entrée écrite tant qu'elle n'a pas expiré", async () => {
    const supabase = new FakeSupabase();
    const cache = createSupabaseExtractionCache(supabase as never, META);
    const entry = { product: fakeProduct(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    await cache.set("key-1", entry);
    const result = await cache.get("key-1");
    expect(result?.product.brand?.value).toBe("Apple");
  });

  it("retourne null pour une entrée expirée", async () => {
    const supabase = new FakeSupabase();
    const cache = createSupabaseExtractionCache(supabase as never, META);
    await cache.set("key-1", { product: fakeProduct(), expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await cache.get("key-1")).toBeNull();
  });

  it("écrit les métadonnées de version en base pour la traçabilité", async () => {
    const supabase = new FakeSupabase();
    const cache = createSupabaseExtractionCache(supabase as never, META);
    await cache.set("key-1", { product: fakeProduct(), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const row = supabase.table("ai_extraction_cache")[0] as { model: string; prompt_version: number };
    expect(row.model).toBe("gpt-4o-mini");
    expect(row.prompt_version).toBe(1);
  });
});
