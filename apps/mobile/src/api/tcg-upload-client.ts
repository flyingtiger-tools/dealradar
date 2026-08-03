import Constants from "expo-constants";
import * as ImageManipulator from "expo-image-manipulator";
import { createClient } from "@supabase/supabase-js";

/**
 * Upload direct vers le bucket privé `analysis-uploads` (migration 0012,
 * ADR 0010/LOT 8) — le client mobile écrit directement dans Storage avec
 * son propre jeton (RLS propriétaire), jamais via un relais backend qui
 * recevrait l'octet binaire. Redimensionne/compresse avant l'envoi (règle
 * LOT 8 : ne jamais envoyer une photo brute pleine résolution).
 */

const STORAGE_BUCKET = "analysis-uploads";
const MAX_DIMENSION = 1600;
/** Relevé de 0.7 à 0.9 (LOT 8A) : une seconde passe de compression lourde après la capture caméra dégradait la lisibilité des petits numéros de collection imprimés en bas de carte — voir le rapport d'audit du 2026-08-03. `MAX_DIMENSION` inchangée pour ce premier test isolé. */
const JPEG_COMPRESSION = 0.9;

function supabaseConfig(): { url: string; anonKey: string } {
  const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined;
  return { url: extra?.supabaseUrl ?? "", anonKey: extra?.supabaseAnonKey ?? "" };
}

export class TcgUploadError extends Error {}

/**
 * Redimensionne (largeur/hauteur max `MAX_DIMENSION`) et compresse en JPEG
 * avant tout envoi réseau — réduit la bande passante et le coût de
 * traitement IA, jamais une exigence de qualité pour la lecture des
 * informations visibles sur la carte (règle explicite LOT 8, jamais une
 * pleine résolution envoyée par défaut).
 */
async function resizeAndCompress(imageUri: string): Promise<{ uri: string }> {
  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: MAX_DIMENSION } }],
    { compress: JPEG_COMPRESSION, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: result.uri };
}

/**
 * Upload la photo (déjà redimensionnée/compressée) sous
 * `<userId>/<clientRequestId>/photo.jpg` — même convention de chemin que la
 * policy RLS (migration 0012 : premier segment = propriétaire). Retourne
 * l'URL au format attendu par `POST /v1/analyses`
 * (`imageReferences[].url` doit contenir `/analysis-uploads/<userId>/`).
 */
export async function uploadTcgCardPhoto(
  accessToken: string,
  userId: string,
  clientRequestId: string,
  imageUri: string,
): Promise<{ url: string }> {
  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey) {
    throw new TcgUploadError("Configuration Supabase manquante côté application mobile (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY).");
  }

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { uri: preparedUri } = await resizeAndCompress(imageUri);

  const response = await fetch(preparedUri);
  const blob = await response.blob();

  const path = `${userId}/${clientRequestId}/photo.jpg`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) {
    throw new TcgUploadError(`Envoi de la photo impossible : ${error.message}`);
  }

  return { url: `${url}/storage/v1/object/${STORAGE_BUCKET}/${path}` };
}

/**
 * Retire la photo après traitement — "ne pas conserver l'image plus
 * longtemps que nécessaire" (règle LOT 8). Best-effort : un échec de
 * suppression n'est jamais bloquant pour l'affichage du résultat.
 */
export async function deleteTcgCardPhoto(accessToken: string, userId: string, clientRequestId: string): Promise<void> {
  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey) return;
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const path = `${userId}/${clientRequestId}/photo.jpg`;
  await supabase.storage.from(STORAGE_BUCKET).remove([path]).catch(() => undefined);
}
