import type { CacheEntry, ExtractionCache } from "@dealradar/ai";

export interface CacheTimings {
  /** Somme des durées de tous les appels get()/set() sur ce cache décoré, en millisecondes. */
  totalMs: number;
  getCalls: number;
  setCalls: number;
}

/**
 * Décore un `ExtractionCache` existant pour chronométrer get()/set() sans
 * toucher à `packages/ai` — pur enveloppement de l'interface déjà exportée.
 */
export function createTimingCache(inner: ExtractionCache): { cache: ExtractionCache; timings: CacheTimings } {
  const timings: CacheTimings = { totalMs: 0, getCalls: 0, setCalls: 0 };

  const cache: ExtractionCache = {
    async get(key: string): Promise<CacheEntry | null> {
      const startedAt = performance.now();
      try {
        return await inner.get(key);
      } finally {
        timings.totalMs += performance.now() - startedAt;
        timings.getCalls += 1;
      }
    },
    async set(key: string, entry: CacheEntry): Promise<void> {
      const startedAt = performance.now();
      try {
        await inner.set(key, entry);
      } finally {
        timings.totalMs += performance.now() - startedAt;
        timings.setCalls += 1;
      }
    },
  };

  return { cache, timings };
}
