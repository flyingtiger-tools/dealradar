/**
 * Faux `expo-file-system` en mémoire — même esprit que
 * `packages/benchmark/src/online/__tests__/fake-supabase.ts` : un helper de
 * test non détecté comme suite (pas de suffixe `.test.ts`), requis à
 * l'intérieur d'une factory `jest.mock(...)` (évite tout problème de hoisting
 * Jest). Couvre uniquement la surface réellement utilisée par
 * `storage.ts`/`export-dataset.ts` — jamais un mock générique de tout
 * `expo-file-system`.
 */

interface FakeFsEntry {
  type: "file" | "dir";
  content: string;
}

export interface FakeFileSystemModule {
  documentDirectory: string;
  cacheDirectory: string;
  EncodingType: { Base64: string; UTF8: string };
  getInfoAsync: (uri: string) => Promise<{ exists: boolean; uri: string; isDirectory?: boolean }>;
  makeDirectoryAsync: (uri: string, options?: unknown) => Promise<void>;
  writeAsStringAsync: (uri: string, content: string, options?: unknown) => Promise<void>;
  readAsStringAsync: (uri: string, options?: unknown) => Promise<string>;
  deleteAsync: (uri: string, options?: { idempotent?: boolean }) => Promise<void>;
  moveAsync: (options: { from: string; to: string }) => Promise<void>;
  copyAsync: (options: { from: string; to: string }) => Promise<void>;
  readDirectoryAsync: (dirUri: string) => Promise<string[]>;
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: () => Promise<{ granted: boolean; directoryUri: string | null }>;
    createFileAsync: (parentUri: string, fileName: string, mimeType: string) => Promise<string>;
    writeAsStringAsync: (uri: string, content: string, options?: unknown) => Promise<void>;
  };
}

export function createFakeFileSystemModule(options: { safGranted?: boolean } = {}): FakeFileSystemModule {
  const store = new Map<string, FakeFsEntry>();
  // Lu à CHAQUE appel (jamais capturé une seule fois à la création) : un test peut
  // passer un accesseur (`get safGranted()`) dont la valeur change entre deux appels
  // (ex. `beforeEach` qui bascule un flag partagé) — capturer `options.safGranted` une
  // seule fois ici figerait la valeur au moment de la création du module mocké.
  const readSafGranted = () => options.safGranted ?? false;

  return {
    documentDirectory: "file:///doc/",
    cacheDirectory: "file:///cache/",
    EncodingType: { Base64: "base64", UTF8: "utf8" },
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
    async copyAsync({ from, to }) {
      const entry = store.get(from);
      if (!entry) throw new Error(`ENOENT: ${from}`);
      store.set(to, { ...entry });
    },
    async readDirectoryAsync(dirUri) {
      const prefix = dirUri.endsWith("/") ? dirUri : `${dirUri}/`;
      const names: string[] = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix) && key !== dirUri) {
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) names.push(rest);
        }
      }
      return names;
    },
    StorageAccessFramework: {
      async requestDirectoryPermissionsAsync() {
        return readSafGranted() ? { granted: true, directoryUri: "content://saf/tree/xyz" } : { granted: false, directoryUri: null };
      },
      async createFileAsync(parentUri, fileName) {
        const uri = `${parentUri}/${fileName}.zip`;
        store.set(uri, { type: "file", content: "" });
        return uri;
      },
      async writeAsStringAsync(uri, content) {
        store.set(uri, { type: "file", content });
      },
    },
  };
}
