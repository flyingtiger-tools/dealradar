import { createHash } from "node:crypto";
import type { CacheKeyParts } from "./types";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Fingerprint stable d'un texte (titre + description + catégorie) —
 * utilisé même quand aucune image n'est impliquée (l'immense majorité des
 * annonces suffisamment identifiables par le texte, cf. ordre paresseux de
 * `extractProduct`).
 */
export function computeTextFingerprint(parts: { title: string; description: string | null; categorySlug: string }): string {
  const normalized = JSON.stringify({
    title: parts.title.trim().toLowerCase(),
    description: (parts.description ?? "").trim().toLowerCase(),
    categorySlug: parts.categorySlug,
  });
  return sha256Hex(normalized);
}

/**
 * Clé de cache versionnée — provider, modèle exact, version de prompt,
 * version de schéma, version de l'extracteur déterministe et fingerprint de
 * contenu entrent tous dans le hash. Un changement de n'importe laquelle de
 * ces dimensions produit une clé différente : l'ancienne entrée devient
 * invisible sans qu'aucune invalidation explicite ne soit nécessaire.
 */
export function computeCacheKey(parts: CacheKeyParts): string {
  const normalized = JSON.stringify({
    provider: parts.provider,
    model: parts.model,
    promptVersion: parts.promptVersion,
    schemaVersion: parts.schemaVersion,
    deterministicExtractorVersion: parts.deterministicExtractorVersion,
    contentFingerprint: parts.contentFingerprint,
  });
  return sha256Hex(normalized);
}
