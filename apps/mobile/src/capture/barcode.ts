import type { BarcodeScanningResult } from "expo-camera";
import type { DetectedBarcode } from "./types";

/** Toutes les familles de codes supportées par expo-camera — générique, aucune priorité métier. */
export const SUPPORTED_BARCODE_TYPES = [
  "aztec",
  "ean13",
  "ean8",
  "qr",
  "pdf417",
  "upc_e",
  "datamatrix",
  "code39",
  "code93",
  "itf14",
  "codabar",
  "code128",
  "upc_a",
] as const;

/** Traduit le résultat natif expo-camera vers le type universel — aucune logique métier ici. */
export function toDetectedBarcode(result: BarcodeScanningResult): DetectedBarcode {
  return {
    format: result.type,
    rawValue: result.data,
    boundingBox: result.bounds
      ? {
          x: result.bounds.origin.x,
          y: result.bounds.origin.y,
          width: result.bounds.size.width,
          height: result.bounds.size.height,
        }
      : null,
  };
}

/** Dédoublonne par (format, valeur) — la callback native peut se déclencher plusieurs fois pour un même code visible en continu à l'écran. */
export function dedupeBarcodes(barcodes: DetectedBarcode[]): DetectedBarcode[] {
  const seen = new Set<string>();
  const result: DetectedBarcode[] = [];
  for (const barcode of barcodes) {
    const key = `${barcode.format}:${barcode.rawValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(barcode);
  }
  return result;
}
