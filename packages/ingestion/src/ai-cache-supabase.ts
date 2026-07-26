import type { SupabaseClient } from "@supabase/supabase-js";
import type { CacheEntry, ExtractionCache, ExtractedProduct } from "@dealradar/ai";

interface CacheRow {
  cache_key: string;
  provider: string;
  model: string;
  prompt_version: number;
  schema_version: number;
  deterministic_version: number;
  result: ExtractedProduct;
  expires_at: string;
}

export interface AiCacheWriteMeta {
  provider: string;
  model: string;
  promptVersion: number;
  schemaVersion: number;
  deterministicVersion: number;
}

/**
 * Implémentation Supabase de `ExtractionCache` (@dealradar/ai) — cache
 * persisté et versionné (table `ai_extraction_cache`, migration 0011).
 * `packages/ai` reste indépendant de Supabase : c'est cette implémentation,
 * pas le paquet, qui connaît la base de données.
 */
export function createSupabaseExtractionCache(supabase: SupabaseClient, meta: AiCacheWriteMeta): ExtractionCache {
  return {
    async get(key: string): Promise<CacheEntry | null> {
      const { data } = await supabase
        .from("ai_extraction_cache")
        .select("result, expires_at")
        .eq("cache_key", key)
        .maybeSingle();
      const row = data as Pick<CacheRow, "result" | "expires_at"> | null;
      if (!row) return null;
      if (new Date(row.expires_at).getTime() <= Date.now()) return null;

      await supabase.from("ai_extraction_cache").update({ last_used_at: new Date().toISOString() }).eq("cache_key", key);

      return { product: row.result, expiresAt: row.expires_at };
    },
    async set(key: string, entry: CacheEntry): Promise<void> {
      const row: CacheRow = {
        cache_key: key,
        provider: meta.provider,
        model: meta.model,
        prompt_version: meta.promptVersion,
        schema_version: meta.schemaVersion,
        deterministic_version: meta.deterministicVersion,
        result: entry.product,
        expires_at: entry.expiresAt,
      };
      await supabase.from("ai_extraction_cache").upsert(row, { onConflict: "cache_key" });
    },
  };
}
