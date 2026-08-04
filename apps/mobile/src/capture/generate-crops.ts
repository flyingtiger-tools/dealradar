import * as ImageManipulator from "expo-image-manipulator";
import type { DetectedRegion, Point } from "./types";

/**
 * Génère un crop depuis l'image ORIGINALE (déjà réorientée par
 * `normalize-orientation.ts`, jamais déjà réduite) — jamais depuis une
 * copie compressée. Phase A : la région est toujours le cadre de guidage
 * assumé (voir `capture-guide-config.ts`), jamais une détection réelle des
 * contours de l'objet (ADR 0013, limites connues).
 */

export interface AssumedRegionRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Calcule le rectangle du cadre de guidage dans l'espace de coordonnées de
 * l'image capturée, à partir de sa proportion connue à l'écran —
 * approximation assumée (le cadre est centré, l'utilisateur y aligne
 * l'objet), jamais une mesure réelle des contours physiques.
 */
export function computeAssumedRegionRect(
  imageWidth: number,
  imageHeight: number,
  aspectRatio: number,
  widthFraction: number,
): AssumedRegionRect {
  const clampedFraction = Math.min(Math.max(widthFraction, 0.01), 1);
  const regionWidth = Math.round(imageWidth * clampedFraction);
  const regionHeightRaw = Math.round(regionWidth / aspectRatio);
  const regionHeight = Math.min(regionHeightRaw, imageHeight);
  const originX = Math.round((imageWidth - regionWidth) / 2);
  const originY = Math.round((imageHeight - regionHeight) / 2);
  return { originX, originY, width: regionWidth, height: regionHeight };
}

export async function generateGuideFrameCrop(imageUri: string, rect: AssumedRegionRect): Promise<DetectedRegion> {
  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ crop: { originX: rect.originX, originY: rect.originY, width: rect.width, height: rect.height } }],
    { format: ImageManipulator.SaveFormat.JPEG },
  );

  const corners: [Point, Point, Point, Point] = [
    { x: rect.originX, y: rect.originY },
    { x: rect.originX + rect.width, y: rect.originY },
    { x: rect.originX + rect.width, y: rect.originY + rect.height },
    { x: rect.originX, y: rect.originY + rect.height },
  ];

  return {
    kind: "guide_frame_assumed",
    corners,
    crop: { uri: result.uri, width: result.width, height: result.height },
  };
}
