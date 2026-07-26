import type { ExtractedProduct } from "../types";

export interface CacheKeyParts {
  provider: string;
  model: string;
  promptVersion: number;
  schemaVersion: number;
  deterministicExtractorVersion: number;
  /** Hash du texte normalisé + (hash d'image réel si téléchargée, sinon URLs triées — TTL réduit dans ce cas, voir cache/compute-key.ts). */
  contentFingerprint: string;
}

export interface CacheEntry {
  product: ExtractedProduct;
  expiresAt: string;
}

/**
 * Cache persisté et versionné — jamais seulement en mémoire pour l'usage
 * réel (l'implémentation Supabase vit dans `packages/ingestion`).
 * L'invalidation est automatique : `computeCacheKey` inclut provider/
 * modèle/versions dans le hash, donc un changement de l'un d'eux rend
 * l'ancienne entrée invisible (jamais lue), pas seulement "peut-être stale".
 */
export interface ExtractionCache {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
}
