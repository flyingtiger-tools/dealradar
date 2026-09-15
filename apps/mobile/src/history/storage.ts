import * as FileSystem from "expo-file-system";
import { historyManifestSchema } from "./schema";
import { emptyHistoryManifest, HISTORY_MAX_ENTRIES, HISTORY_SCHEMA_VERSION, type HistoryEntry, type HistoryManifest } from "./types";

/**
 * Persistence locale de l'historique (LOT "beta product readiness",
 * Phase 13/46/47/48) — `expo-file-system` uniquement (déjà utilisé par
 * `dataset-capture/storage.ts` pour un besoin similaire ; réutilisation du
 * PATTERN d'écriture atomique, jamais un import croisé entre les deux
 * domaines — voir la consigne "réutilise les idées sans coupler les
 * domaines"). Aucune nouvelle dépendance native, aucune nouvelle table
 * Supabase.
 *
 * Un seul fichier JSON (`manifest.json`), jamais une image/base64 stockée
 * (voir `history/types.ts`, `HistoryEntry` ne porte aucune donnée lourde).
 */

const ROOT_DIR = `${FileSystem.documentDirectory}history/`;
const MANIFEST_PATH = `${ROOT_DIR}manifest.json`;
const MANIFEST_TMP_PATH = `${ROOT_DIR}manifest.json.tmp`;

export class HistoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Aucune entrée d'historique avec l'id "${id}".`);
    this.name = "HistoryNotFoundError";
  }
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(ROOT_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
}

/**
 * Sauvegarde le fichier illisible/corrompu sous un nom horodaté avant de
 * repartir propre (Phase 47 : "sauvegarde optionnelle .corrupt" — choisi
 * plutôt qu'un reset silencieux pur, pour garder une trace exploitable en
 * diagnostic sans jamais bloquer l'utilisateur). Best-effort : un échec de
 * cette sauvegarde ne doit jamais empêcher l'app de repartir avec un
 * historique vide.
 */
async function quarantineCorruptManifest(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(MANIFEST_PATH);
    if (!info.exists) return;
    const quarantinePath = `${ROOT_DIR}manifest.${Date.now()}.corrupt`;
    await FileSystem.moveAsync({ from: MANIFEST_PATH, to: quarantinePath });
  } catch {
    // Best-effort — voir commentaire de fonction.
  }
}

/**
 * Ne lève JAMAIS (Phase 47 : "l'app ne doit jamais être brickée à cause de
 * l'historique local") — tout fichier absent, JSON invalide, ou
 * structurellement invalide déclenche une mise en quarantaine puis un
 * repli sur un manifest vide, jamais une exception propagée à l'appelant.
 */
export async function loadHistoryManifest(): Promise<HistoryManifest> {
  await ensureDir();
  const info = await FileSystem.getInfoAsync(MANIFEST_PATH);
  if (!info.exists) return emptyHistoryManifest();

  let raw: string;
  try {
    raw = await FileSystem.readAsStringAsync(MANIFEST_PATH);
  } catch {
    return emptyHistoryManifest();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    await quarantineCorruptManifest();
    return emptyHistoryManifest();
  }

  const result = historyManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    await quarantineCorruptManifest();
    return emptyHistoryManifest();
  }

  // Emplacement pour une future migration de schéma (Phase 46) : si
  // `HISTORY_SCHEMA_VERSION` change un jour, une fonction de migration se
  // brancherait ici, entre la validation structurelle ci-dessus et le
  // retour — inutile aujourd'hui (version 1 unique), volontairement
  // documenté plutôt qu'anticipé sans besoin réel.
  return result.data;
}

/** Écriture atomique par fichier temporaire — même technique que `dataset-capture/storage.ts` (Phase 48), jamais un `writeAsStringAsync` direct sur `manifest.json`. */
async function saveHistoryManifestAtomic(manifest: HistoryManifest): Promise<void> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(MANIFEST_TMP_PATH, JSON.stringify(manifest));
  const existing = await FileSystem.getInfoAsync(MANIFEST_PATH);
  if (existing.exists) await FileSystem.deleteAsync(MANIFEST_PATH, { idempotent: true });
  await FileSystem.moveAsync({ from: MANIFEST_TMP_PATH, to: MANIFEST_PATH });
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const manifest = await loadHistoryManifest();
  return [...manifest.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getHistoryEntry(id: string): Promise<HistoryEntry | null> {
  const manifest = await loadHistoryManifest();
  return manifest.entries.find((entry) => entry.id === id) ?? null;
}

/**
 * Ajoute une entrée et applique la limite de conservation (Phase 15) — au-
 * delà de `HISTORY_MAX_ENTRIES`, les entrées les plus anciennes (par
 * `createdAt`) sont supprimées. La décision "faut-il ajouter cette
 * analyse ?" (pertinence, doublons) appartient à `history/policy.ts`,
 * jamais à ce dépôt — un `HistoryRepository` reste un CRUD simple.
 */
export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const manifest = await loadHistoryManifest();
  manifest.entries.push(entry);
  if (manifest.entries.length > HISTORY_MAX_ENTRIES) {
    manifest.entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    manifest.entries.length = HISTORY_MAX_ENTRIES;
  }
  await saveHistoryManifestAtomic(manifest);
}

export async function removeHistoryEntry(id: string): Promise<void> {
  const manifest = await loadHistoryManifest();
  const index = manifest.entries.findIndex((entry) => entry.id === id);
  if (index === -1) throw new HistoryNotFoundError(id);
  manifest.entries.splice(index, 1);
  await saveHistoryManifestAtomic(manifest);
}

export async function clearHistory(): Promise<void> {
  await saveHistoryManifestAtomic(emptyHistoryManifest());
}

/** Retourne l'entrée mise à jour — l'appelant (UI) n'a jamais besoin de recalculer l'état localement, la source de vérité reste ce dépôt. */
export async function toggleHistoryFavorite(id: string): Promise<HistoryEntry> {
  const manifest = await loadHistoryManifest();
  const index = manifest.entries.findIndex((entry) => entry.id === id);
  if (index === -1) throw new HistoryNotFoundError(id);
  const updated: HistoryEntry = { ...manifest.entries[index]!, favorite: !manifest.entries[index]!.favorite };
  manifest.entries[index] = updated;
  await saveHistoryManifestAtomic(manifest);
  return updated;
}

/** "Effacer les favoris" (Phase 51, Internal Tools) — retire le drapeau `favorite` de toutes les entrées, jamais une suppression de l'historique lui-même (Favoris n'est qu'un filtre sur l'historique, voir Phase 19 stratégie A). */
export async function clearAllFavorites(): Promise<void> {
  const manifest = await loadHistoryManifest();
  manifest.entries = manifest.entries.map((entry) => (entry.favorite ? { ...entry, favorite: false } : entry));
  await saveHistoryManifestAtomic(manifest);
}

export async function countHistory(): Promise<number> {
  const manifest = await loadHistoryManifest();
  return manifest.entries.length;
}

export async function countFavorites(): Promise<number> {
  const manifest = await loadHistoryManifest();
  return manifest.entries.filter((entry) => entry.favorite).length;
}

export const __internal = { ROOT_DIR, MANIFEST_PATH, HISTORY_SCHEMA_VERSION };
