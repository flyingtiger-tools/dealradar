import type { QualitySignals, QualityWarningCode } from "./types";

/**
 * Quality Engine minimal (Phase A, ADR 0013) — uniquement des heuristiques
 * dérivées de métadonnées (dimensions, taille fichier, EXIF
 * d'exposition/ISO si disponible, dimensions du crop du cadre assumé).
 * Aucune analyse de pixels réelle (flou/luminosité mesurés
 * nécessiteraient des frame processors ou un modèle embarqué,
 * explicitement hors périmètre Phase A). Ce module ne bloque jamais une
 * capture lui-même — il produit des avertissements ; la décision d'accepter
 * ou de redemander une photo reste à l'appelant.
 */

const MIN_ORIGINAL_SHORT_SIDE_PX = 1200;
const MIN_REGION_SHORT_SIDE_PX = 500;
/** Temps de pose au-delà duquel un flou de mouvement à main levée devient plausible — heuristique, pas une mesure de netteté. */
const BLUR_RISK_EXPOSURE_SECONDS = 1 / 15;
/** ISO élevé = l'appareil a compensé un faible éclairage — heuristique dérivée de métadonnée, pas une mesure photométrique. */
const LOW_LIGHT_ISO_THRESHOLD = 1600;

/** Lit `exif.ExposureTime` de façon défensive — jamais une exception si l'EXIF est absent, mal formé, ou d'un type inattendu (les noms de champs EXIF varient selon l'appareil/OS). */
export function parseExifExposureTime(exif: unknown): number | null {
  if (typeof exif !== "object" || exif === null) return null;
  const value = (exif as Record<string, unknown>).ExposureTime;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Lit `exif.ISOSpeedRatings` de façon défensive — jamais une exception, jamais une invention si absent. */
export function parseExifIsoSpeed(exif: unknown): number | null {
  if (typeof exif !== "object" || exif === null) return null;
  const raw = (exif as Record<string, unknown>).ISOSpeedRatings;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function evaluateQuality(signals: QualitySignals): QualityWarningCode[] {
  const warnings: QualityWarningCode[] = [];

  const shortSide = Math.min(signals.originalWidth, signals.originalHeight);
  if (shortSide < MIN_ORIGINAL_SHORT_SIDE_PX) warnings.push("LOW_RESOLUTION");

  if (signals.exposureTimeSeconds !== null && signals.exposureTimeSeconds > BLUR_RISK_EXPOSURE_SECONDS) {
    warnings.push("POSSIBLE_BLUR");
  }

  if (signals.isoSpeed !== null && signals.isoSpeed >= LOW_LIGHT_ISO_THRESHOLD) {
    warnings.push("LOW_LIGHT");
  }

  if (signals.assumedRegionCropWidth !== null && signals.assumedRegionCropHeight !== null) {
    const regionShortSide = Math.min(signals.assumedRegionCropWidth, signals.assumedRegionCropHeight);
    if (regionShortSide < MIN_REGION_SHORT_SIDE_PX) warnings.push("OBJECT_TOO_SMALL_IN_FRAME");
  }

  return warnings;
}

/** Séparé de `evaluateQuality` : dépend du tag EXIF brut, pas des signaux numériques dérivés. */
export function possibleRotationWarning(exifOrientation: number | null): QualityWarningCode[] {
  return exifOrientation !== null && exifOrientation !== 1 ? ["POSSIBLE_ROTATION"] : [];
}
