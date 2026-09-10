import * as FileSystem from "expo-file-system";
import * as Crypto from "expo-crypto";
import { datasetCaptureManifestSchema } from "./manifest-schema";
import {
  emptyManifest,
  type DatasetCaptureExample,
  type DatasetCaptureManifest,
  type DatasetGroundTruthDraft,
} from "./types";
import type { OrientationInfo, QualitySignals, QualityWarningCode } from "../capture/types";

/**
 * Stockage local du dataset TCG capturé en dev (Phase 2) — `expo-file-system`
 * uniquement, aucune requête réseau, aucun SDK Supabase importé dans ce
 * fichier (voir `__tests__/no-network-invariant.test.ts`). Manifest JSON +
 * un fichier image par exemple, jamais une base64 imbriquée dans le JSON
 * (fichiers image potentiellement volumineux — éviter un JSON.parse géant).
 */

const ROOT_DIR = `${FileSystem.documentDirectory}tcg-dataset-capture/`;
const IMAGES_DIR = `${ROOT_DIR}images/`;
const MANIFEST_PATH = `${ROOT_DIR}manifest.json`;
const MANIFEST_TMP_PATH = `${ROOT_DIR}manifest.json.tmp`;

export class DatasetCaptureCorruptionError extends Error {
  constructor(reason: string) {
    super(`Manifest du dataset capture corrompu : ${reason}`);
    this.name = "DatasetCaptureCorruptionError";
  }
}

export class DatasetCaptureNotFoundError extends Error {
  constructor(id: string) {
    super(`Aucun exemple avec l'id "${id}".`);
    this.name = "DatasetCaptureNotFoundError";
  }
}

async function ensureDirs(): Promise<void> {
  const rootInfo = await FileSystem.getInfoAsync(ROOT_DIR);
  if (!rootInfo.exists) await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  const imagesInfo = await FileSystem.getInfoAsync(IMAGES_DIR);
  if (!imagesInfo.exists) await FileSystem.makeDirectoryAsync(IMAGES_DIR, { intermediates: true });
}

function imagePathFor(id: string): string {
  return `${IMAGES_DIR}${id}.jpg`;
}

/** Ne corrige jamais silencieusement un manifest invalide (même règle que le futur validateur Phase 5) — lève `DatasetCaptureCorruptionError` avec la raison précise plutôt que de retourner un manifest vide ou partiellement réparé. */
export async function loadManifest(): Promise<DatasetCaptureManifest> {
  await ensureDirs();
  const info = await FileSystem.getInfoAsync(MANIFEST_PATH);
  if (!info.exists) return emptyManifest();

  const raw = await FileSystem.readAsStringAsync(MANIFEST_PATH);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new DatasetCaptureCorruptionError(`JSON invalide (${error instanceof Error ? error.message : String(error)}).`);
  }

  const result = datasetCaptureManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new DatasetCaptureCorruptionError(result.error.issues.map((issue) => `${issue.path.join(".") || "(racine)"}: ${issue.message}`).join(" ; "));
  }
  return result.data;
}

/**
 * Écriture "atomique" par écrasement via fichier temporaire — écrit d'abord
 * `manifest.json.tmp`, puis remplace `manifest.json` seulement une fois
 * l'écriture terminée. Réduit (sans l'éliminer totalement — pas de garantie
 * fsync au niveau OS) la fenêtre pendant laquelle une interruption
 * (crash/fermeture forcée de l'app) pourrait laisser un manifest tronqué —
 * jamais un `writeAsStringAsync` direct sur `manifest.json`, qui laisserait
 * un fichier partiellement écrit visible immédiatement en cas d'échec.
 */
async function saveManifestAtomic(manifest: DatasetCaptureManifest): Promise<void> {
  await ensureDirs();
  await FileSystem.writeAsStringAsync(MANIFEST_TMP_PATH, JSON.stringify(manifest));
  const existing = await FileSystem.getInfoAsync(MANIFEST_PATH);
  if (existing.exists) await FileSystem.deleteAsync(MANIFEST_PATH, { idempotent: true });
  await FileSystem.moveAsync({ from: MANIFEST_TMP_PATH, to: MANIFEST_PATH });
}

export async function listExamples(): Promise<DatasetCaptureExample[]> {
  const manifest = await loadManifest();
  return [...manifest.examples].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getExample(id: string): Promise<DatasetCaptureExample | null> {
  const manifest = await loadManifest();
  return manifest.examples.find((example) => example.id === id) ?? null;
}

/**
 * Détection de doublon probable (Phase 2) — jamais bloquante, seulement
 * informative : compare nom de carte + set + numéro + variante (normalisés
 * en minuscules/trim) contre les exemples déjà enregistrés. Ne compare
 * jamais le numéro de collection via une égalité stricte de texte brute :
 * volontairement plus permissif ici (simple normalisation locale, jamais
 * `collectorNumbersMatch()` de `@dealradar/connectors` — `apps/mobile` ne
 * doit pas dépendre d'un paquet backend pour une simple heuristique
 * d'avertissement UI, contrairement à la comparaison de précision du
 * benchmark où l'exactitude est requise).
 */
function draftSignature(draft: Pick<DatasetGroundTruthDraft, "cardName" | "setName" | "collectorNumber" | "variant">): string {
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  return [norm(draft.cardName), norm(draft.setName), norm(draft.collectorNumber), norm(draft.variant)].join("|");
}

export function findDuplicateCandidates(existing: readonly DatasetCaptureExample[], draft: DatasetGroundTruthDraft): string[] {
  if (draft.cardName.trim() === "") return [];
  const signature = draftSignature(draft);
  return existing.filter((example) => draftSignature(example.groundTruth) === signature).map((example) => example.id);
}

export interface AddExampleInput {
  /** URI source de l'image (ex. cache caméra, éphémère) — copiée vers un emplacement durable, jamais référencée telle quelle. */
  sourceImageUri: string;
  qualityWarnings: QualityWarningCode[];
  qualitySignals: QualitySignals;
  orientation: OrientationInfo;
  groundTruth: DatasetGroundTruthDraft;
}

export interface AddExampleResult {
  example: DatasetCaptureExample;
  /** Ids d'exemples déjà enregistrés qui partagent la même signature (nom/set/numéro/variante) — jamais bloquant, l'appelant décide quoi en faire. */
  duplicateCandidateIds: string[];
}

export async function addExample(input: AddExampleInput): Promise<AddExampleResult> {
  await ensureDirs();
  const id = Crypto.randomUUID();
  const destUri = imagePathFor(id);
  await FileSystem.copyAsync({ from: input.sourceImageUri, to: destUri });

  const now = new Date().toISOString();
  const example: DatasetCaptureExample = {
    id,
    createdAt: now,
    updatedAt: now,
    localImageUri: destUri,
    qualityWarnings: input.qualityWarnings,
    qualitySignals: input.qualitySignals,
    orientation: input.orientation,
    groundTruth: input.groundTruth,
  };

  const manifest = await loadManifest();
  const duplicateCandidateIds = findDuplicateCandidates(manifest.examples, input.groundTruth);
  manifest.examples.push(example);
  await saveManifestAtomic(manifest);

  return { example, duplicateCandidateIds };
}

export async function updateExample(id: string, groundTruth: DatasetGroundTruthDraft): Promise<DatasetCaptureExample> {
  const manifest = await loadManifest();
  const index = manifest.examples.findIndex((example) => example.id === id);
  if (index === -1) throw new DatasetCaptureNotFoundError(id);

  const updated: DatasetCaptureExample = { ...manifest.examples[index]!, groundTruth, updatedAt: new Date().toISOString() };
  manifest.examples[index] = updated;
  await saveManifestAtomic(manifest);
  return updated;
}

/** Suppression avec confirmation gérée par l'appelant (UI) — cette fonction, elle, exécute sans redemander. Best-effort sur le fichier image (un fichier déjà absent n'empêche jamais le nettoyage du manifest). */
export async function deleteExample(id: string): Promise<void> {
  const manifest = await loadManifest();
  const index = manifest.examples.findIndex((example) => example.id === id);
  if (index === -1) throw new DatasetCaptureNotFoundError(id);

  const [removed] = manifest.examples.splice(index, 1);
  await saveManifestAtomic(manifest);
  await FileSystem.deleteAsync(removed!.localImageUri, { idempotent: true });
}

export interface IntegrityReport {
  /** Exemples du manifest dont le fichier image référencé n'existe plus sur disque. */
  missingImageExampleIds: string[];
  /** Fichiers présents dans le dossier images/ mais référencés par aucun exemple du manifest. */
  orphanImageFiles: string[];
  /** Groupes d'exemples partageant la même signature (nom/set/numéro/variante) — doublons probables, jamais supprimés automatiquement. */
  duplicateGroups: string[][];
}

/** Diagnostic de cohérence (Phase 2 : "corruption detection", "duplicate detection") — ne corrige jamais rien automatiquement, seulement un rapport que l'UI peut afficher. */
export async function checkIntegrity(): Promise<IntegrityReport> {
  const manifest = await loadManifest();
  await ensureDirs();

  const dirEntries = await FileSystem.readDirectoryAsync(IMAGES_DIR);
  const referencedFileNames = new Set(manifest.examples.map((example) => example.localImageUri.split("/").pop()!));

  const missingImageExampleIds: string[] = [];
  for (const example of manifest.examples) {
    const info = await FileSystem.getInfoAsync(example.localImageUri);
    if (!info.exists) missingImageExampleIds.push(example.id);
  }

  const orphanImageFiles = dirEntries.filter((fileName) => !referencedFileNames.has(fileName));

  const groups = new Map<string, string[]>();
  for (const example of manifest.examples) {
    if (example.groundTruth.cardName.trim() === "") continue;
    const signature = draftSignature(example.groundTruth);
    const group = groups.get(signature) ?? [];
    group.push(example.id);
    groups.set(signature, group);
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);

  return { missingImageExampleIds, orphanImageFiles, duplicateGroups };
}

export const __internal = { ROOT_DIR, IMAGES_DIR, MANIFEST_PATH };
