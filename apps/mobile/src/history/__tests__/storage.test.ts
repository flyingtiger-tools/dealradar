jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystemModule());

import * as FileSystem from "expo-file-system";
import {
  addHistoryEntry,
  clearHistory,
  countFavorites,
  countHistory,
  getHistoryEntry,
  HistoryNotFoundError,
  listHistory,
  loadHistoryManifest,
  removeHistoryEntry,
  toggleHistoryFavorite,
  __internal,
} from "../storage";
import { HISTORY_MAX_ENTRIES, HISTORY_SCHEMA_VERSION, type HistoryEntry } from "../types";

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: overrides.id ?? `entry-${Math.random()}`,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    category: "pokemon_tcg",
    identity: { name: "Pikachu", setName: "Base Set", collectorNumber: "58", language: "en", variant: null },
    verdict: null,
    marketValue: { low: 9.63, high: 9.63, currency: "CHF" },
    confidence: 97,
    source: "tcgdex",
    favorite: false,
    productKey: "pokemon_tcg|base set|58|en|",
    ...overrides,
  };
}

describe("history/storage — sans réseau, un fichier manifest JSON", () => {
  // Le module `expo-file-system` mocké (fake en mémoire) est mis en cache
  // par Jest pour tout le fichier — sans ce nettoyage, les entrées
  // ajoutées par un test précédent resteraient visibles dans le suivant.
  beforeEach(async () => {
    await clearHistory();
  });

  it("loadHistoryManifest() sur un dossier vierge : manifest vide au bon schemaVersion, jamais une exception", async () => {
    const manifest = await loadHistoryManifest();
    expect(manifest).toEqual({ schemaVersion: HISTORY_SCHEMA_VERSION, entries: [] });
  });

  it("add() puis list() : l'entrée est bien persistée, triée du plus récent au plus ancien", async () => {
    await addHistoryEntry(entry({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }));
    await addHistoryEntry(entry({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" }));

    const list = await listHistory();
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("get() retrouve une entrée par id, null si absente", async () => {
    await addHistoryEntry(entry({ id: "x" }));
    expect((await getHistoryEntry("x"))?.id).toBe("x");
    expect(await getHistoryEntry("missing")).toBeNull();
  });

  it("remove() supprime l'entrée ; lève HistoryNotFoundError si l'id n'existe pas", async () => {
    await addHistoryEntry(entry({ id: "y" }));
    await removeHistoryEntry("y");
    expect(await getHistoryEntry("y")).toBeNull();
    await expect(removeHistoryEntry("y")).rejects.toBeInstanceOf(HistoryNotFoundError);
  });

  it("clear() vide tout l'historique", async () => {
    await addHistoryEntry(entry({ id: "z" }));
    await clearHistory();
    expect(await listHistory()).toEqual([]);
  });

  it("toggleFavorite() bascule le drapeau et retourne l'entrée à jour, jamais besoin de recalculer côté UI", async () => {
    await addHistoryEntry(entry({ id: "f", favorite: false }));
    const updated = await toggleHistoryFavorite("f");
    expect(updated.favorite).toBe(true);
    const reverted = await toggleHistoryFavorite("f");
    expect(reverted.favorite).toBe(false);
  });

  it("toggleFavorite() sur un id absent lève HistoryNotFoundError", async () => {
    await expect(toggleHistoryFavorite("nope")).rejects.toBeInstanceOf(HistoryNotFoundError);
  });

  it("countHistory()/countFavorites() reflètent l'état réel", async () => {
    await addHistoryEntry(entry({ id: "c1", favorite: true }));
    await addHistoryEntry(entry({ id: "c2", favorite: false }));
    expect(await countHistory()).toBe(2);
    expect(await countFavorites()).toBe(1);
  });

  it("limite de conservation (Phase 15) : au-delà de HISTORY_MAX_ENTRIES, les plus anciennes sont supprimées", async () => {
    for (let i = 0; i < HISTORY_MAX_ENTRIES + 5; i++) {
      await addHistoryEntry(entry({ id: `bulk-${i}`, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }));
    }
    const list = await listHistory();
    expect(list.length).toBe(HISTORY_MAX_ENTRIES);
    // Les 5 plus anciennes (bulk-0..bulk-4) ont été évincées.
    expect(list.some((e) => e.id === "bulk-0")).toBe(false);
    expect(list.some((e) => e.id === `bulk-${HISTORY_MAX_ENTRIES + 4}`)).toBe(true);
  });

  it("manifest JSON invalide (corrompu) : jamais un crash, repli sur un historique vide, fichier mis en quarantaine", async () => {
    await FileSystem.makeDirectoryAsync(__internal.ROOT_DIR, { intermediates: true } as never);
    await FileSystem.writeAsStringAsync(__internal.MANIFEST_PATH, "{ceci n'est pas du JSON valide");

    const manifest = await loadHistoryManifest();
    expect(manifest.entries).toEqual([]);

    // Le fichier original a bien été déplacé (plus à son emplacement d'origine).
    const info = await FileSystem.getInfoAsync(__internal.MANIFEST_PATH);
    expect(info.exists).toBe(false);
  });

  it("manifest structurellement invalide (schéma zod refusé) : même repli propre, jamais une exception qui remonte", async () => {
    await FileSystem.makeDirectoryAsync(__internal.ROOT_DIR, { intermediates: true } as never);
    await FileSystem.writeAsStringAsync(__internal.MANIFEST_PATH, JSON.stringify({ schemaVersion: 1, entries: [{ id: "bad" }] }));

    const manifest = await loadHistoryManifest();
    expect(manifest.entries).toEqual([]);
  });

  it("persistance après 'redémarrage' logique (Phase 50) : rappeler list()/get() après add() retrouve les mêmes données, sans état en mémoire caché", async () => {
    await addHistoryEntry(entry({ id: "persisted" }));
    // Simule un redémarrage : relire depuis la 'persistence' (le fake FS)
    // sans jamais réutiliser une variable JS conservée entre les deux appels.
    const manifestAfterRestart = await loadHistoryManifest();
    expect(manifestAfterRestart.entries.some((e) => e.id === "persisted")).toBe(true);
  });
});
