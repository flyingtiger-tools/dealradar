/**
 * Types universels de capture (LOT "Universal Capture Intake", Phase A,
 * ADR 0013) — aucun champ Pokémon/TCG, aucune catégorie métier. Consommé
 * par un futur adapter (TCG ou autre), jamais l'inverse : ce module ne doit
 * jamais importer quoi que ce soit depuis un dossier propre à une
 * catégorie.
 */

export interface Point {
  x: number;
  y: number;
}

export interface NormalizedImage {
  uri: string;
  width: number;
  height: number;
  format: "jpeg";
}

/** Phase A : seule la méthode "cadre assumé" existe — aucune détection de contour réelle (voir ADR 0013, section limites). */
export type DetectedRegionKind = "guide_frame_assumed";

export interface DetectedRegion {
  kind: DetectedRegionKind;
  corners: [Point, Point, Point, Point] | null;
  /** Toujours généré depuis l'image originale pleine résolution, jamais depuis une copie déjà réduite. */
  crop: { uri: string; width: number; height: number };
}

export interface DetectedBarcode {
  format: string;
  rawValue: string;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

export type CaptureType = "camera";

export interface OrientationInfo {
  /** Valeur EXIF brute lue avant normalisation, à titre de traçabilité uniquement — jamais utilisée telle quelle par un appelant. */
  exifOrientation: number | null;
  /** true UNIQUEMENT si les pixels ont été réellement réencodés dans le bon sens par ce module — jamais une simple confiance en un tag EXIF (voir normalize-orientation.ts). */
  pixelsPhysicallyRotated: boolean;
}

export type QualityWarningCode =
  | "LOW_RESOLUTION"
  | "POSSIBLE_BLUR"
  | "LOW_LIGHT"
  | "OBJECT_TOO_SMALL_IN_FRAME"
  | "POSSIBLE_ROTATION";

export interface QualitySignals {
  originalWidth: number;
  originalHeight: number;
  fileSizeBytes: number;
  /** Heuristique dérivée du temps de pose EXIF si disponible — jamais une mesure réelle de netteté par analyse de pixels (hors périmètre Phase A). null si l'EXIF ne fournit pas l'information. */
  exposureTimeSeconds: number | null;
  /** Heuristique dérivée de l'ISO EXIF si disponible — jamais une mesure photométrique réelle. */
  isoSpeed: number | null;
  /** Dimensions du crop de la région assumée — sert de proxy honnête pour "objet trop petit dans le cadre" en l'absence de détection réelle. null si aucune région n'a pu être générée. */
  assumedRegionCropWidth: number | null;
  assumedRegionCropHeight: number | null;
}

export interface UniversalCaptureResult {
  captureType: CaptureType;
  normalizedImage: NormalizedImage;
  detectedRegions: DetectedRegion[];
  barcodes: DetectedBarcode[];
  orientation: OrientationInfo;
  qualitySignals: QualitySignals;
  warnings: QualityWarningCode[];
}
