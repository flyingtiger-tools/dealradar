import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Signe une URL d'image du bucket privé `analysis-uploads` avant de la
 * transmettre à un provider IA (LOT "Railway worker recovery + real non-TCG
 * E2E"). Bug réel trouvé en traitant une vraie requête : le pipeline
 * générique (`apps/workers/src/jobs/process-analysis.ts`) transmettait
 * `image_references[].url` telle quelle aux providers (`packages/ai/src/
 * provider/openai.ts` : `image_url: { url: image.url }`) — un chemin
 * `/storage/v1/object/<bucket>/<path>` BRUT. Ce bucket est `public: false`
 * (confirmé via `storage.buckets`), donc le serveur du provider IA (qui n'a
 * ni la session Supabase de l'utilisateur ni la clé service role) ne peut
 * jamais télécharger l'image — chaque extraction échouait silencieusement
 * en `PROVIDER_ERROR`, jamais une exception qui aurait révélé la cause.
 *
 * `process-tcg-card-analysis.ts` évite déjà ce piège pour la verticale TCG
 * (`createSignedUrl`, `SIGNED_URL_TTL_SECONDS = 300`) — ce module reprend
 * exactement la même logique (constantes identiques) pour la rendre
 * disponible au pipeline générique SANS toucher au fichier TCG existant,
 * déjà testé et fonctionnel (jamais une régression sur ce chemin pour
 * corriger un autre chemin).
 */

const SIGNED_URL_TTL_SECONDS = 300;
const STORAGE_BUCKET = "analysis-uploads";

function extractStoragePath(imageUrl: string): string | null {
  const marker = `/${STORAGE_BUCKET}/`;
  const index = imageUrl.indexOf(marker);
  if (index === -1) return null;
  return imageUrl.slice(index + marker.length).split("?")[0] ?? null;
}

/**
 * `null` si l'URL ne pointe pas vers `analysis-uploads` (jamais signée à
 * tort une URL externe) ou si la signature échoue (jamais une exception —
 * l'appelant décide quoi faire d'une image qu'il ne peut pas rendre
 * exploitable, ex. l'ignorer plutôt que de transmettre l'URL brute privée).
 */
export async function signStorageImageUrl(db: SupabaseClient, imageUrl: string): Promise<string | null> {
  const storagePath = extractStoragePath(imageUrl);
  if (!storagePath) return null;
  const { data, error } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
