import Constants from "expo-constants";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { supabase } from "../lib/supabase-client";
import { getCurrentUserId } from "../auth/session";

/**
 * Upload direct vers le bucket privé `analysis-uploads` (migration 0012,
 * ADR 0010/LOT 8) — le client mobile écrit directement dans Storage avec
 * la session Supabase courante (RLS propriétaire), jamais via un relais
 * backend qui recevrait l'octet binaire. Redimensionne/compresse avant
 * l'envoi (règle LOT 8 : ne jamais envoyer une photo brute pleine
 * résolution).
 *
 * Réutilise le client Supabase partagé déjà authentifié (LOT 9) — plus de
 * client jetable reconstruit à partir d'un jeton passé en paramètre.
 *
 * Lit le fichier via `expo-file-system` + décode en `ArrayBuffer` — jamais
 * `fetch(uri).blob()` : ce chemin échoue de façon intermittente sur
 * React Native (`Network request failed`, cause réelle rencontrée en test
 * sur appareil) — la doc Supabase elle-même déconseille `Blob` côté
 * React Native pour cette raison, `ArrayBuffer` est le chemin fiable.
 */

/** Décodage base64 → ArrayBuffer sans dépendance externe — `atob` est disponible sur ce runtime (Hermes RN 0.76+), déjà confirmé par test. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

const STORAGE_BUCKET = "analysis-uploads";
const MAX_DIMENSION = 1600;
/** Relevé de 0.7 à 0.9 (LOT 8A) : une seconde passe de compression lourde après la capture caméra dégradait la lisibilité des petits numéros de collection imprimés en bas de carte — voir le rapport d'audit du 2026-08-03. `MAX_DIMENSION` inchangée pour ce premier test isolé. */
const JPEG_COMPRESSION = 0.9;

function supabaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { supabaseUrl?: string } | undefined;
  return extra?.supabaseUrl ?? "";
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

async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new TcgUploadError("Aucune session active — connecte-toi avant d'envoyer une photo.");
  return userId;
}

/**
 * Upload la photo (déjà redimensionnée/compressée) sous
 * `<userId>/<clientRequestId>/photo.jpg` — même convention de chemin que la
 * policy RLS (migration 0012 : premier segment = propriétaire). Retourne
 * l'URL au format attendu par `POST /v1/analyses`
 * (`imageReferences[].url` doit contenir `/analysis-uploads/<userId>/`).
 */
export async function uploadTcgCardPhoto(clientRequestId: string, imageUri: string): Promise<{ url: string }> {
  const url = supabaseUrl();
  if (!url) {
    throw new TcgUploadError("Configuration Supabase manquante côté application mobile (EXPO_PUBLIC_SUPABASE_URL).");
  }
  const userId = await requireUserId();

  const { uri: preparedUri } = await resizeAndCompress(imageUri);

  const base64 = await FileSystem.readAsStringAsync(preparedUri, { encoding: FileSystem.EncodingType.Base64 });
  const arrayBuffer = base64ToArrayBuffer(base64);

  const path = `${userId}/${clientRequestId}/photo.jpg`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, arrayBuffer, {
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
export async function deleteTcgCardPhoto(clientRequestId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  const path = `${userId}/${clientRequestId}/photo.jpg`;
  await supabase.storage.from(STORAGE_BUCKET).remove([path]).catch(() => undefined);
}
