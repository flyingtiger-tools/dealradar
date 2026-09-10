import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { tcgDatasetSchema, type TcgDataset, type TcgGroundTruth } from "@dealradar/contracts";
import { buildStoredZip, type ZipEntryInput } from "./zip-writer";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { listExamples } from "./storage";
import type { DatasetCaptureExample } from "./types";

/**
 * Export local du dataset capturé (Phase 4) — construit
 * `dealradar-tcg-dataset-YYYYMMDD.zip` (dataset.json + images/) et tente de
 * le déposer dans un dossier choisi par l'utilisateur via Storage Access
 * Framework (Android, primitive déjà fournie par `expo-file-system` —
 * AUCUNE dépendance nouvelle ajoutée pour cette fonctionnalité). Aucun
 * cloud, aucun upload automatique : la SAF ouvre un sélecteur de dossier
 * natif, l'utilisateur choisit où le fichier atterrit sur SON appareil.
 */

function toGroundTruthEntry(example: DatasetCaptureExample): TcgGroundTruth {
  const notes = example.groundTruth.notes.trim();
  return {
    id: example.id,
    imagePath: `photos/${example.id}.jpg`,
    game: example.groundTruth.game,
    cardName: example.groundTruth.cardName,
    setName: example.groundTruth.setName,
    collectorNumber: example.groundTruth.collectorNumber,
    language: example.groundTruth.language,
    variant: example.groundTruth.variant,
    productKind: example.groundTruth.productKind,
    gradingCompany: example.groundTruth.gradingCompany,
    grade: example.groundTruth.grade,
    notes: notes === "" ? undefined : notes,
    tags: example.groundTruth.tags,
  };
}

/**
 * Pure — construit le `dataset.json` à partir d'exemples déjà chargés,
 * jamais de lecture disque ici. Se valide lui-même via `tcgDatasetSchema`
 * avant de retourner : un export ne doit jamais produire un fichier que
 * `loadTcgDataset()` (côté benchmark) refuserait de charger.
 */
export function buildExportDataset(examples: readonly DatasetCaptureExample[]): TcgDataset {
  const dataset: TcgDataset = {
    provenance: "real",
    note: `Exporté depuis l'outil dev "TCG Dataset Capture" le ${new Date().toISOString()} — ${examples.length} exemple(s).`,
    entries: examples.map(toGroundTruthEntry),
  };
  tcgDatasetSchema.parse(dataset);
  return dataset;
}

function zipFileName(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `dealradar-tcg-dataset-${y}${m}${d}.zip`;
}

export class DatasetExportError extends Error {}

export interface ExportResult {
  fileName: string;
  exampleCount: number;
  /** true si le fichier a été déposé dans un dossier choisi par l'utilisateur (Android, Storage Access Framework). false : seulement écrit dans le stockage privé de l'app (`internalPath`) — récupérable via un outil de fichiers avec accès root/adb uniquement, jamais "facilement récupérable" tel quel. */
  savedToUserFolder: boolean;
  /** Chemin interne (sandbox de l'app) où le ZIP est toujours écrit en premier, même quand `savedToUserFolder` est true. */
  internalPath: string;
}

/** Construit le ZIP à partir des exemples déjà chargés — étape pure séparée du disque pour rester testable sans dépendre de Storage Access Framework. */
export async function buildExportZip(examples: readonly DatasetCaptureExample[]): Promise<Uint8Array> {
  const dataset = buildExportDataset(examples);
  const datasetJsonBytes = Uint8Array.from(JSON.stringify(dataset, null, 2), (c) => c.charCodeAt(0));

  const zipEntries: ZipEntryInput[] = [{ path: "dataset.json", data: datasetJsonBytes }];
  for (const example of examples) {
    const base64 = await FileSystem.readAsStringAsync(example.localImageUri, { encoding: FileSystem.EncodingType.Base64 });
    zipEntries.push({ path: `photos/${example.id}.jpg`, data: base64ToBytes(base64) });
  }
  return buildStoredZip(zipEntries);
}

export async function exportDataset(): Promise<ExportResult> {
  const examples = await listExamples();
  if (examples.length === 0) {
    throw new DatasetExportError("Aucun exemple à exporter — capture au moins une photo avant d'exporter.");
  }

  const zipBytes = await buildExportZip(examples);
  const fileName = zipFileName(new Date());
  const internalPath = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(internalPath, bytesToBase64(zipBytes), { encoding: FileSystem.EncodingType.Base64 });

  if (Platform.OS !== "android") {
    // Storage Access Framework est Android-only — sur les autres plateformes, le ZIP reste accessible uniquement en interne.
    return { fileName, exampleCount: examples.length, savedToUserFolder: false, internalPath };
  }

  try {
    const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted || !permission.directoryUri) {
      return { fileName, exampleCount: examples.length, savedToUserFolder: false, internalPath };
    }
    const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
      permission.directoryUri,
      fileName.replace(/\.zip$/, ""),
      "application/zip",
    );
    await FileSystem.StorageAccessFramework.writeAsStringAsync(destUri, bytesToBase64(zipBytes), { encoding: FileSystem.EncodingType.Base64 });
    return { fileName, exampleCount: examples.length, savedToUserFolder: true, internalPath };
  } catch {
    // Best-effort : le ZIP reste de toute façon disponible en interne (internalPath) — jamais une exception qui masquerait qu'il a bien été produit.
    return { fileName, exampleCount: examples.length, savedToUserFolder: false, internalPath };
  }
}
