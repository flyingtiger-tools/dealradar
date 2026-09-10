import { readFileSync } from "node:fs";
import path from "node:path";
import { tcgDatasetSchema, type TcgDataset } from "./dataset-schema";

export class TcgDatasetValidationError extends Error {
  constructor(filePath: string, cause: unknown) {
    super(`Dataset TCG invalide (${filePath}) : ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TcgDatasetValidationError";
  }
}

/** Charge et valide un dataset TCG JSON — même discipline que `../dataset/load-dataset.ts` : jamais une donnée non validée en aval. */
export function loadTcgDataset(filePath: string): TcgDataset {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new TcgDatasetValidationError(filePath, error);
  }
  const parsed = tcgDatasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TcgDatasetValidationError(filePath, parsed.error);
  }
  return parsed.data;
}

/** Résout `imagePath` (relatif au fichier dataset) vers un chemin absolu — ne vérifie jamais que le fichier existe (la photo peut être ajoutée plus tard, voir README). */
export function resolveTcgImagePath(datasetFilePath: string, imagePath: string): string {
  return path.resolve(path.dirname(datasetFilePath), imagePath);
}
