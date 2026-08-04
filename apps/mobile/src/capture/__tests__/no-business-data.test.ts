const mockManipulateAsync = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: "jpeg" },
  FlipType: { Vertical: "vertical", Horizontal: "horizontal" },
}));

import { computeAssumedRegionRect, generateGuideFrameCrop } from "../generate-crops";
import { normalizeOrientation } from "../normalize-orientation";
import { evaluateQuality } from "../quality-engine";
import { toDetectedBarcode } from "../barcode";
import type { UniversalCaptureResult } from "../types";

/** Sous-chaînes propres à une catégorie métier — aucune ne doit jamais apparaître dans un UniversalCaptureResult (ADR 0013, "le moteur universel ne doit connaître aucun champ Pokémon"). */
const FORBIDDEN_BUSINESS_SUBSTRINGS = [
  "pokemon",
  "pokémon",
  "tcg",
  "nymble",
  "card",
  "carte",
  "lego",
  "brique",
  "livre",
  "isbn",
  "console",
  "chaussure",
  "vêtement",
];

describe("UniversalCaptureResult — indépendance métier stricte", () => {
  it("un résultat assemblé à partir des builders réels ne contient aucune donnée métier", async () => {
    mockManipulateAsync.mockResolvedValueOnce({ uri: "file://normalized.jpg", width: 3000, height: 4000 });
    mockManipulateAsync.mockResolvedValueOnce({ uri: "file://cropped.jpg", width: 1800, height: 2400 });

    const normalized = await normalizeOrientation({ uri: "file://raw.jpg", width: 3000, height: 4000, exifOrientation: 6 });
    const rect = computeAssumedRegionRect(normalized.width, normalized.height, 0.75, 0.6);
    const region = await generateGuideFrameCrop(normalized.uri, rect);

    const qualitySignals = {
      originalWidth: normalized.width,
      originalHeight: normalized.height,
      fileSizeBytes: 2_500_000,
      exposureTimeSeconds: null,
      isoSpeed: null,
      assumedRegionCropWidth: region.crop.width,
      assumedRegionCropHeight: region.crop.height,
    };

    const result: UniversalCaptureResult = {
      captureType: "camera",
      normalizedImage: { uri: normalized.uri, width: normalized.width, height: normalized.height, format: "jpeg" },
      detectedRegions: [region],
      barcodes: [toDetectedBarcode({ type: "ean13", data: "1234567890123", cornerPoints: [], bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } } })],
      orientation: normalized.orientation,
      qualitySignals,
      warnings: evaluateQuality(qualitySignals),
    };

    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of FORBIDDEN_BUSINESS_SUBSTRINGS) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
