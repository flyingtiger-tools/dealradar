import { readFileSync } from "node:fs";
import { datasetSchema, type Dataset } from "./schema";

export class DatasetValidationError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Dataset invalide (${path}) : ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DatasetValidationError";
  }
}

/** Charge et valide un dataset JSON — jamais de donnée non validée en aval (même discipline que le reste du projet). */
export function loadDataset(path: string): Dataset {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new DatasetValidationError(path, error);
  }
  const parsed = datasetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DatasetValidationError(path, parsed.error);
  }
  return parsed.data;
}
