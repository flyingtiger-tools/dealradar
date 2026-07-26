import { createHash } from "node:crypto";
import type { SelectableImage } from "../image-policy/select-and-validate-images";

/**
 * Fingerprint d'un ensemble d'images sélectionnées. Utilise le hash de
 * contenu réel quand il est fourni (ex. `content_hash` déjà calculé par
 * `packages/ingestion` sur `listing_media`) ; à défaut, retombe sur les URLs
 * triées — limite assumée et documentée (une signature d'URL peut changer
 * sans que l'image change), compensée par un TTL de cache réduit côté appelant.
 */
export function computeImageFingerprint(images: Array<SelectableImage & { contentHash?: string | null }>): {
  fingerprint: string;
  usedContentHash: boolean;
} {
  const sorted = [...images].sort((a, b) => a.url.localeCompare(b.url));
  const allHaveHash = sorted.length > 0 && sorted.every((image) => !!image.contentHash);

  const basis = allHaveHash
    ? sorted.map((image) => image.contentHash).join("|")
    : sorted.map((image) => image.url).join("|");

  return {
    fingerprint: createHash("sha256").update(basis, "utf8").digest("hex"),
    usedContentHash: allHaveHash,
  };
}
