import * as ImageManipulator from "expo-image-manipulator";
import type { OrientationInfo } from "./types";

/**
 * Normalise l'orientation physique des pixels — jamais une confiance en un
 * tag EXIF seul.
 *
 * ROOT CAUSE d'un bug de double-rotation trouvé sur Samsung S24 Ultra
 * (photo capturée à 90° de l'attendu, warning "Orientation possiblement
 * incorrecte" affiché même quand une correction était appliquée) :
 *
 * 1. `CameraView.takePictureAsync({ exif: true, skipProcessing: false })`
 *    sur Android NE tourne PAS les pixels quand `exif: true` est demandé —
 *    confirmé en lisant `ResolveTakenPicture.kt` (package `expo-camera`
 *    natif) : `decodeBitmap()` applique `decodeAndRotateBitmap()` (rotation
 *    réelle) uniquement dans la branche `!options.exif` ; avec `exif: true`
 *    (notre cas), c'est un simple `BitmapFactory.decodeByteArray()` SANS
 *    rotation. Le tag EXIF `Orientation` brut (ex. 6) est bien renvoyé côté
 *    JS, mais les pixels restent dans l'orientation capteur d'origine.
 * 2. `expo-image-manipulator` (utilisé ci-dessous) charge l'image source,
 *    côté Android, via **Glide** (`expo-image-loader`'s
 *    `ImageLoaderModule.loadImageForManipulationFromURL` fait
 *    `Glide.with(context).asBitmap().load(url)`) — et le `Downsampler` de
 *    Glide **tourne déjà nativement le bitmap selon le tag EXIF au
 *    décodage, par défaut** (documenté explicitement dans son javadoc :
 *    "returns a Bitmap that is rotated to match any EXIF data present in
 *    the stream" — https://bumptech.github.io/glide/javadocs/4110/com/bumptech/glide/load/resource/bitmap/Downsampler.html).
 *
 * Résultat : si CE module applique en plus sa PROPRE rotation calculée à
 * partir du même tag EXIF (comme le faisait une version antérieure), le
 * bitmap déjà corrigé par Glide se retrouve tourné une seconde fois —
 * double rotation, photo à 90°/180° de l'attendu selon la valeur EXIF.
 * Confirmé par lecture de `Downsampler.decode()` (Glide) et de
 * `ImageManipulatorContext.kt` (un `manipulateAsync(uri, [], ...)` sans
 * transformateur renvoie le bitmap tel que chargé par Glide, donc déjà
 * réorienté).
 *
 * Correction minimale : ne JAMAIS recalculer nous-mêmes une rotation/un
 * miroir depuis le tag EXIF. On se contente de faire passer l'image par
 * `manipulateAsync` (sans action) pour forcer sa matérialisation via ce
 * même décodeur Glide déjà correcteur — le fichier obtenu est correctement
 * orienté, et ses `width`/`height` reflètent la rotation déjà appliquée.
 */

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

  // Orientation standard (1) ou EXIF absent : rien à corriger — et rien à
  // matérialiser, le fichier source n'a jamais besoin de repasser par
  // Glide. `pixelsPhysicallyRotated` n'est vrai que si l'EXIF confirme
  // explicitement l'absence de rotation nécessaire — jamais une supposition
  // quand l'EXIF est simplement absent.
  if (exifOrientation === null || exifOrientation === 1) {
    return { uri, width, height, orientation: { exifOrientation, pixelsPhysicallyRotated: exifOrientation === 1 } };
  }

  // Aucune action explicite : on délègue entièrement la correction au
  // décodeur (Glide côté Android) déclenché par ce simple passage dans
  // manipulateAsync — voir le commentaire de fichier ci-dessus.
  const result = await ImageManipulator.manipulateAsync(uri, [], { format: ImageManipulator.SaveFormat.JPEG });
  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    orientation: { exifOrientation, pixelsPhysicallyRotated: true },
  };
}
