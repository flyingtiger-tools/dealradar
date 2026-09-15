/**
 * Faux `expo-file-system` en mémoire — copie volontaire (pas un import
 * croisé) de `dataset-capture/__tests__/fake-file-system.ts` : même
 * pattern utile aux deux domaines, mais aucun couplage entre leurs suites
 * de tests (voir la consigne "réutilise les idées sans coupler les
 * domaines", LOT "beta product readiness"). Couvre uniquement la surface
 * réellement utilisée par `history/storage.ts`.
 */

interface FakeFsEntry {
  type: "file" | "dir";
  content: string;
}

export interface FakeFileSystemModule {
  documentDirectory: string;
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; uri: string; isDirectory?: boolean }>;
  makeDirectoryAsync: (uri: string, options?: unknown) => Promise<void>;
  writeAsStringAsync: (uri: string, content: string, options?: unknown) => Promise<void>;
  readAsStringAsync: (uri: string, options?: unknown) => Promise<string>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  moveAsync: (options: { from: string; to: string }) => Promise<void>;
}

export function createFakeFileSystemModule(): FakeFileSystemModule {
  const store = new Map<string, FakeFsEntry>();

  return {
    documentDirectory: "file:///doc/",
    async getInfoAsync(uri) {
      const entry = store.get(uri);
      return entry ? { exists: true, uri, isDirectory: entry.type === "dir" } : { exists: false, uri };
    },
    async makeDirectoryAsync(uri) {
      store.set(uri, { type: "dir", content: "" });
    },
    async writeAsStringAsync(uri, content) {
      store.set(uri, { type: "file", content });
    },
    async readAsStringAsync(uri) {
      const entry = store.get(uri);
      if (!entry || entry.type !== "file") throw new Error(`ENOENT: ${uri}`);
      return entry.content;
    },
    async deleteAsync(uri, delOptions) {
      if (!store.has(uri) && !delOptions?.idempotent) throw new Error(`ENOENT: ${uri}`);
      store.delete(uri);
    },
    async moveAsync({ from, to }) {
      const entry = store.get(from);
      if (!entry) throw new Error(`ENOENT: ${from}`);
      store.delete(from);
      store.set(to, entry);
    },
  };
}
