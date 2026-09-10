import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { collectorNumbersMatch } from "@dealradar/connectors";
import { loadTcgDataset, resolveTcgImagePath, TcgDatasetValidationError } from "./load-tcg-dataset";
import type { TcgGroundTruth } from "./dataset-schema";

/**
 * Validateur d'un dataset TCG exporté (Phase 5, "long lot local") — destiné
 * à vérifier un `dataset.json` + `photos/` produit par l'outil dev mobile
 * "TCG Dataset Capture" (`apps/mobile/src/dataset-capture/export-dataset.ts`)
 * avant de le committer dans `packages/benchmark/datasets/tcg/`. Ne corrige
 * JAMAIS rien silencieusement — seulement un rapport détaillé, à lire et
 * corriger à la main.
 *
 * Le format n'embarque pas de champ de version explicite dans le JSON
 * lui-même (voir `TCG_DATASET_FORMAT_VERSION`, `@dealradar/contracts`) — la
 * validation structurelle via `tcgDatasetSchema` (zod, appelée par
 * `loadTcgDataset()`) EST la vérification de version : un dataset produit
 * par un format incompatible échoue ce parse, jamais silencieusement accepté
 * avec des champs manquants/mal typés.
 */

export type ValidationSeverity = "INVALID" | "WARNING";

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Code stable, machine-lisible — pour un futur filtrage/CI, jamais seulement le message libre. */
  code: string;
  message: string;
  entryId?: string;
}

export type TcgDatasetValidationStatus = "VALID" | "WARNING" | "INVALID";

export interface TcgDatasetValidationReport {
  status: TcgDatasetValidationStatus;
  datasetPath: string;
  entryCount: number;
  issues: ValidationIssue[];
}

const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png"];

function textSignature(entry: Pick<TcgGroundTruth, "cardName" | "setName" | "variant">): string {
  return [entry.cardName, entry.setName, entry.variant].map((v) => (v ?? "").trim().toLowerCase()).join("|");
}

/** true si deux valeurs collectorNumber (potentiellement null) sont "la même" — jamais une comparaison de texte brute (voir collectorNumbersMatch, même règle que run-tcg-example.ts). */
function sameCollectorNumber(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return collectorNumbersMatch(a, b);
}

function findDuplicateGroups(entries: readonly TcgGroundTruth[]): string[][] {
  const byTextSignature = new Map<string, TcgGroundTruth[]>();
  for (const entry of entries) {
    const key = textSignature(entry);
    const group = byTextSignature.get(key) ?? [];
    group.push(entry);
    byTextSignature.set(key, group);
  }

  const duplicateGroups: string[][] = [];
  for (const group of byTextSignature.values()) {
    if (group.length < 2) continue;
    // Sous-groupement par numéro de collection ÉQUIVALENT (pas une égalité de texte brute) —
    // deux entrées "096" et "96" pour la même carte/set/variante sont le même doublon probable.
    const clusters: TcgGroundTruth[][] = [];
    for (const entry of group) {
      const cluster = clusters.find((c) => sameCollectorNumber(c[0]!.collectorNumber, entry.collectorNumber));
      if (cluster) cluster.push(entry);
      else clusters.push([entry]);
    }
    for (const cluster of clusters) {
      if (cluster.length > 1) duplicateGroups.push(cluster.map((e) => e.id));
    }
  }
  return duplicateGroups;
}

function listImageFilesRecursively(dir: string, baseDir: string = dir): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listImageFilesRecursively(fullPath, baseDir));
    } else if (SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, "/"));
    }
  }
  return results;
}

export function validateTcgDataset(datasetPath: string): TcgDatasetValidationReport {
  let dataset;
  try {
    dataset = loadTcgDataset(datasetPath);
  } catch (error) {
    const message =
      error instanceof TcgDatasetValidationError ? error.message : error instanceof Error ? error.message : String(error);
    return { status: "INVALID", datasetPath, entryCount: 0, issues: [{ severity: "INVALID", code: "SCHEMA_INVALID", message }] };
  }

  const issues: ValidationIssue[] = [];
  const idCounts = new Map<string, number>();
  const imagePathOwners = new Map<string, string>();

  for (const entry of dataset.entries) {
    idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);

    const normalizedImagePath = entry.imagePath.replace(/\\/g, "/");
    if (path.isAbsolute(normalizedImagePath) || normalizedImagePath.split("/").includes("..")) {
      issues.push({ severity: "INVALID", code: "UNSAFE_IMAGE_PATH", entryId: entry.id, message: `Chemin d'image non sûr (absolu ou hors du dossier dataset) : "${entry.imagePath}".` });
      continue;
    }

    const owner = imagePathOwners.get(normalizedImagePath);
    if (owner && owner !== entry.id) {
      issues.push({ severity: "INVALID", code: "IMAGE_PATH_COLLISION", entryId: entry.id, message: `"${entry.imagePath}" est référencé par plusieurs entrées (${owner}, ${entry.id}).` });
    } else {
      imagePathOwners.set(normalizedImagePath, entry.id);
    }

    const ext = path.extname(normalizedImagePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      issues.push({
        severity: "INVALID",
        code: "UNSUPPORTED_EXTENSION",
        entryId: entry.id,
        message: `Extension "${ext || "(aucune)"}" non supportée pour "${entry.imagePath}" (attendu : ${SUPPORTED_EXTENSIONS.join(", ")}).`,
      });
    }

    const resolvedPath = resolveTcgImagePath(datasetPath, entry.imagePath);
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
      issues.push({ severity: "INVALID", code: "IMAGE_MISSING", entryId: entry.id, message: `Image introuvable sur disque : "${entry.imagePath}".` });
    }

    if (entry.setName === null && entry.collectorNumber === null) {
      issues.push({
        severity: "WARNING",
        code: "INCOMPLETE_GROUND_TRUTH",
        entryId: entry.id,
        message: `Ni "setName" ni "collectorNumber" renseignés pour "${entry.cardName}" — corroboration catalogue impossible pour cet exemple.`,
      });
    }
  }

  for (const [id, count] of idCounts) {
    if (count > 1) issues.push({ severity: "INVALID", code: "DUPLICATE_ID", entryId: id, message: `L'id "${id}" apparaît ${count} fois — les ids doivent être uniques.` });
  }

  for (const group of findDuplicateGroups(dataset.entries)) {
    issues.push({
      severity: "WARNING",
      code: "PROBABLE_DUPLICATE",
      message: `Exemples probablement en double (même nom/set/variante, numéro de collection équivalent) : ${group.join(", ")}.`,
    });
  }

  const referenced = new Set(dataset.entries.map((e) => e.imagePath.replace(/\\/g, "/")));
  for (const relativeFile of listImageFilesRecursively(path.dirname(datasetPath))) {
    if (!referenced.has(relativeFile)) {
      issues.push({ severity: "WARNING", code: "ORPHAN_IMAGE_FILE", message: `Fichier image présent mais référencé par aucune entrée du dataset : "${relativeFile}".` });
    }
  }

  const status: TcgDatasetValidationStatus = issues.some((i) => i.severity === "INVALID") ? "INVALID" : issues.length > 0 ? "WARNING" : "VALID";
  return { status, datasetPath, entryCount: dataset.entries.length, issues };
}
