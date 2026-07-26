import type { CacheEntry, ExtractionCache } from "./types";

/** Implémentation mémoire de référence — tests et usage autonome uniquement. L'usage réel passe par le cache Supabase de `packages/ingestion`. */
export function createMemoryCache(): ExtractionCache {
  const store = new Map<string, CacheEntry>();

  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (new Date(entry.expiresAt).getTime() <= Date.now()) {
        store.delete(key);
        return null;
      }
      return entry;
    },
    async set(key, entry) {
      store.set(key, entry);
    },
  };
}
