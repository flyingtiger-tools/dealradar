import * as ImageManipulator from "expo-image-manipulator";
import type { OrientationInfo } from "./types";

/**
 * Normalise l'orientation physique des pixels — jamais une confiance en un
 * tag EXIF seul. expo-camera effectue déjà cette rotation nativement par
 * défaut (`skipProcessing` non activé), mais sa propre documentation
 * signale explicitement des appareils (dont Samsung) où l'orientation par
 * défaut n'est pas fiable — ce module réapplique donc une correction
 * explicite à partir du tag EXIF lu, plutôt que de supposer le travail
 * déjà fait par la caméra.
 */

/** Rotation horaire (degrés) nécessaire pour redresser une image selon son tag EXIF Orientation. Les valeurs 2/4/5/7 impliquent aussi un miroir horizontal, géré séparément. */
const ROTATION_DEGREES_BY_EXIF_ORIENTATION: Record<number, number> = {
  1: 0,
  2: 0,
  3: 180,
  4: 180,
  5: 90,
  6: 90,
  7: 270,
  8: 270,
};

const MIRRORED_EXIF_ORIENTATIONS = new Set([2, 4, 5, 7]);

export interface NormalizeOrientationInput {
  uri: string;
  width: number;
  height: number;
  exifOrientation: number | null;
}

export interface NormalizeOrientationOutput {
  uri: string;
  width: number;
  height: number;
  orientation: OrientationInfo;
}

/** Lit `exif.Orientation` de façon défensive — jamais une exception si l'EXIF est absent, mal formé, ou d'un type inattendu. */
export function parseExifOrientation(exif: unknown): number | null {
  if (typeof exif !== "object" || exif === null) return null;
  const value = (exif as Record<string, unknown>).Orientation;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export async function normalizeOrientation(input: NormalizeOrientationInput): Promise<NormalizeOrientationOutput> {
  const { uri, width, height, exifOrientation } = input;

  // Orientation standard (1) ou EXIF absent : rien à corriger. `pixelsPhysicallyRotated`
  // n'est vrai que si l'EXIF confirme explicitement l'absence de rotation nécessaire —
  // jamais une supposition quand l'EXIF est simplement absent.
  if (exifOrientation === null || exifOrientation === 1) {
    return { uri, width, height, orientation: { exifOrientation, pixelsPhysicallyRotated: exifOrientation === 1 } };
  }

  const rotate = ROTATION_DEGREES_BY_EXIF_ORIENTATION[exifOrientation] ?? 0;
  const actions: ImageManipulator.Action[] = [];
  if (MIRRORED_EXIF_ORIENTATIONS.has(exifOrientation)) {
    actions.push({ flip: ImageManipulator.FlipType.Horizontal });
  }
  if (rotate !== 0) {
    actions.push({ rotate });
  }

  if (actions.length === 0) {
    // Valeur EXIF non reconnue (hors 1-8) : ne jamais deviner une rotation — laisser tel quel, jamais corrigé.
    return { uri, width, height, orientation: { exifOrientation, pixelsPhysicallyRotated: false } };
  }

  const result = await ImageManipulator.manipulateAsync(uri, actions, { format: ImageManipulator.SaveFormat.JPEG });
  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    orientation: { exifOrientation, pixelsPhysicallyRotated: true },
  };
}
