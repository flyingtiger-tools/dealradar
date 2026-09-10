import { z } from "zod";
import { tcgDatasetTagSchema } from "@dealradar/contracts";

/**
 * Validation structurelle du manifest local (`manifest.json`) — utilisée par
 * `storage.ts` pour détecter une corruption au chargement (Phase 2 :
 * "corruption detection"). Ne corrige jamais silencieusement une donnée
 * invalide (même règle que le futur validateur de dataset exporté, Phase 5)
 * — un manifest structurellement invalide lève `DatasetCaptureCorruptionError`.
 */

const groundTruthDraftSchema = z.object({
  game: z.string(),
  cardName: z.string(),
  setName: z.string().nullable(),
  collectorNumber: z.string().nullable(),
  language: z.string().nullable(),
  variant: z.string().nullable(),
  productKind: z.enum(["raw_card", "graded_card"]).nullable(),
  gradingCompany: z.string().nullable(),
  grade: z.string().nullable(),
  notes: z.string(),
  tags: z.array(tcgDatasetTagSchema),
});

const qualityWarningCodeSchema = z.enum([
  "LOW_RESOLUTION",
  "POSSIBLE_BLUR",
  "LOW_LIGHT",
  "OBJECT_TOO_SMALL_IN_FRAME",
  "POSSIBLE_ROTATION",
]);

const qualitySignalsSchema = z.object({
  originalWidth: z.number(),
  originalHeight: z.number(),
  fileSizeBytes: z.number(),
  exposureTimeSeconds: z.number().nullable(),
  isoSpeed: z.number().nullable(),
  assumedRegionCropWidth: z.number().nullable(),
  assumedRegionCropHeight: z.number().nullable(),
});

const orientationInfoSchema = z.object({
  exifOrientation: z.number().nullable(),
  pixelsPhysicallyRotated: z.boolean(),
});

const datasetCaptureExampleSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  localImageUri: z.string().min(1),
  qualityWarnings: z.array(qualityWarningCodeSchema),
  qualitySignals: qualitySignalsSchema,
  orientation: orientationInfoSchema,
  groundTruth: groundTruthDraftSchema,
});

export const datasetCaptureManifestSchema = z.object({
  version: z.number(),
  examples: z.array(datasetCaptureExampleSchema),
});
