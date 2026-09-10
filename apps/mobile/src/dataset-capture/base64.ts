/**
 * Encodage/décodage base64 <-> octets — même primitive `atob`/`btoa` que le
 * client d'upload TCG existant (`base64ToArrayBuffer`, module d'upload
 * réseau — ce fichier-ci ne l'importe jamais, voir
 * `__tests__/no-network-invariant.test.ts`), disponible sur Hermes RN 0.76+
 * (déjà confirmé par test sur ce projet). Jamais `Buffer` (absent du runtime
 * React Native) ni une dépendance externe.
 */

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Découpe en blocs avant `String.fromCharCode(...bytes)` — évite un dépassement de pile d'appel sur de gros tableaux (une image de quelques Mo dépasserait la limite d'arguments d'un appel de fonction). */
const CHUNK_SIZE = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}
