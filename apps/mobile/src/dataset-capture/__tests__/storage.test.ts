let mockRandomUuidCounter = 0;

// Même schéma que `identification/__tests__/tcg-adapter.test.ts` : `expo-crypto`
// appelle un module natif indisponible sous Jest.
jest.mock("expo-crypto", () => ({
  randomUUID: () => `mock-uuid-${++mockRandomUuidCounter}`,
}));

// `require` à l'intérieur de la factory (jamais une variable externe non préfixée
// "mock") — évite tout problème de hoisting `jest.mock` (même schéma que
// `packages/benchmark/src/online/__tests__/fake-supabase.ts`).
jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystemModule());

import * as FileSystem from "expo-file-system";
import {
  addExample,
  checkIntegrity,
  deleteExample,
  DatasetCaptureCorruptionError,
  DatasetCaptureNotFoundError,
  findDuplicateCandidates,
  getExample,
  listExamples,
  loadManifest,
  updateExample,
  __internal,
} from "../storage";
import { emptyGroundTruthDraft, emptyManifest } from "../types";
import type { QualitySignals, QualityWarningCode } from "../../capture/types";

const QUALITY_SIGNALS: QualitySignals = {
  originalWidth: 3000,
  originalHeight: 4000,
  fileSizeBytes: 2_000_000,
  exposureTimeSeconds: null,
  isoSpeed: null,
  assumedRegionCropWidth: 1800,
  assumedRegionCropHeight: 2400,
};
const NO_WARNINGS: QualityWarningCode[] = [];
const ORIENTATION = { exifOrientation: 1, pixelsPhysicallyRotated: false };

function draft(overrides: Partial<ReturnType<typeof emptyGroundTruthDraft>> = {}) {
  return { ...emptyGroundTruthDraft(), cardName: "Nymble", setName: "Phantasmal Flames", collectorNumber: "096", ...overrides };
}

async function seedSourceImage(uri: string, content = "fake-jpeg-bytes"): Promise<void> {
  await FileSystem.writeAsStringAsync(uri, content);
}

describe("dataset-capture/storage — sans réseau, un fichier manifest + un dossier images/", () => {
  it("loadManifest() sur un dossier vierge : manifest vide, jamais une exception", async () => {
    const manifest = await loadManifest();
    expect(manifest.examples).toEqual([]);
  });

  it("addExample() copie l'image source vers un emplacement durable et l'ajoute au manifest", async () => {
    await seedSourceImage("file:///cache/camera-shot-1.jpg");
    const { example, duplicateCandidateIds } = await addExample({
      sourceImageUri: "file:///cache/camera-shot-1.jpg",
      qualityWarnings: NO_WARNINGS,
      qualitySignals: QUALITY_SIGNALS,
      orientation: ORIENTATION,
      groundTruth: draft(),
    });

    expect(duplicateCandidateIds).toEqual([]);
    expect(example.localImageUri).not.toBe("file:///cache/camera-shot-1.jpg");
    expect(example.localImageUri.startsWith(__internal.IMAGES_DIR)).toBe(true);

    const persisted = await getExample(example.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.groundTruth.cardName).toBe("Nymble");

    // L'image copiée est bien lisible à son nouvel emplacement.
    await expect(FileSystem.readAsStringAsync(example.localImageUri)).resolves.toBe("fake-jpeg-bytes");
  });

  it("listExamples() retourne les exemples les plus récents en premier", async () => {
    await seedSourceImage("file:///cache/a.jpg");
    await seedSourceImage("file:///cache/b.jpg");
    const first = await addExample({ sourceImageUri: "file:///cache/a.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: draft({ cardName: "Premier" }) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await addExample({ sourceImageUri: "file:///cache/b.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: draft({ cardName: "Second" }) });

    const list = await listExamples();
    const ids = list.map((e) => e.id);
    expect(ids.indexOf(second.example.id)).toBeLessThan(ids.indexOf(first.example.id));
  });

  it("updateExample() modifie la vérité terrain et met à jour updatedAt sans toucher createdAt ni l'image", async () => {
    await seedSourceImage("file:///cache/c.jpg");
    const { example } = await addExample({ sourceImageUri: "file:///cache/c.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: draft() });

    const updated = await updateExample(example.id, draft({ cardName: "Nymble corrigé", tags: ["leading_zero"] }));
    expect(updated.groundTruth.cardName).toBe("Nymble corrigé");
    expect(updated.createdAt).toBe(example.createdAt);
    expect(updated.localImageUri).toBe(example.localImageUri);
  });

  it("updateExample() sur un id inconnu : DatasetCaptureNotFoundError, jamais une correction silencieuse", async () => {
    await expect(updateExample("id-inexistant", draft())).rejects.toBeInstanceOf(DatasetCaptureNotFoundError);
  });

  it("deleteExample() retire le manifest ET le fichier image ; confirmation gérée par l'appelant, pas ici", async () => {
    await seedSourceImage("file:///cache/d.jpg");
    const { example } = await addExample({ sourceImageUri: "file:///cache/d.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: draft() });

    await deleteExample(example.id);
    expect(await getExample(example.id)).toBeNull();
    await expect(FileSystem.getInfoAsync(example.localImageUri)).resolves.toMatchObject({ exists: false });
  });

  it("deleteExample() sur un id inconnu : DatasetCaptureNotFoundError", async () => {
    await expect(deleteExample("id-inexistant")).rejects.toBeInstanceOf(DatasetCaptureNotFoundError);
  });

  it("findDuplicateCandidates() détecte une signature identique (nom/set/numéro/variante), jamais bloquant", async () => {
    // Nom volontairement unique à ce test : le manifest mock partage son état entre tous
    // les tests de ce fichier (voir le mock `expo-file-system` en tête de fichier) — un
    // nom générique risquerait de collisionner avec un autre test.
    await seedSourceImage("file:///cache/e.jpg");
    const { example: first } = await addExample({
      sourceImageUri: "file:///cache/e.jpg",
      qualityWarnings: NO_WARNINGS,
      qualitySignals: QUALITY_SIGNALS,
      orientation: ORIENTATION,
      groundTruth: draft({ cardName: "Carte Signature Unique Alpha" }),
    });

    const manifest = await loadManifest();
    const candidates = findDuplicateCandidates(manifest.examples, draft({ cardName: "carte signature unique alpha" })); // casse différente, même carte
    expect(candidates).toEqual([first.id]);

    const noMatch = findDuplicateCandidates(manifest.examples, draft({ cardName: "Carte Totalement Différente Beta" }));
    expect(noMatch).toEqual([]);
  });

  it("addExample() renvoie les doublons candidats trouvés au moment de l'ajout (jamais bloqué)", async () => {
    await seedSourceImage("file:///cache/f1.jpg");
    await seedSourceImage("file:///cache/f2.jpg");
    const uniqueDraft = draft({ cardName: "Carte Signature Unique Gamma" });
    const { example: first } = await addExample({ sourceImageUri: "file:///cache/f1.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: uniqueDraft });
    const second = await addExample({ sourceImageUri: "file:///cache/f2.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: uniqueDraft });

    expect(second.duplicateCandidateIds).toEqual([first.id]);
    // Le doublon n'empêche jamais l'ajout : les deux exemples existent bien.
    expect(await getExample(second.example.id)).not.toBeNull();
  });

  it("loadManifest() sur un JSON structurellement invalide : DatasetCaptureCorruptionError, jamais un manifest vide silencieux", async () => {
    await FileSystem.writeAsStringAsync(__internal.MANIFEST_PATH, "ceci n'est pas du JSON {{{");
    try {
      await expect(loadManifest()).rejects.toBeInstanceOf(DatasetCaptureCorruptionError);
    } finally {
      // Restaure un manifest valide : ce fichier mock partage son état avec les autres tests de ce fichier.
      await FileSystem.writeAsStringAsync(__internal.MANIFEST_PATH, JSON.stringify(emptyManifest()));
    }
  });

  it("loadManifest() sur un JSON valide mais hors schéma : DatasetCaptureCorruptionError", async () => {
    await FileSystem.writeAsStringAsync(__internal.MANIFEST_PATH, JSON.stringify({ version: 1, examples: [{ id: "x" }] }));
    try {
      await expect(loadManifest()).rejects.toBeInstanceOf(DatasetCaptureCorruptionError);
    } finally {
      await FileSystem.writeAsStringAsync(__internal.MANIFEST_PATH, JSON.stringify(emptyManifest()));
    }
  });

  it("checkIntegrity() signale une image manquante référencée par le manifest, sans rien corriger", async () => {
    await seedSourceImage("file:///cache/g.jpg");
    const { example } = await addExample({ sourceImageUri: "file:///cache/g.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: draft() });
    await FileSystem.deleteAsync(example.localImageUri, { idempotent: true });

    const report = await checkIntegrity();
    expect(report.missingImageExampleIds).toEqual([example.id]);
    // Rien n'a été corrigé automatiquement : l'exemple existe toujours dans le manifest.
    expect(await getExample(example.id)).not.toBeNull();
  });

  it("checkIntegrity() signale un fichier orphelin (présent sur disque, référencé par aucun exemple)", async () => {
    await FileSystem.writeAsStringAsync(`${__internal.IMAGES_DIR}orphelin.jpg`, "contenu");
    const report = await checkIntegrity();
    expect(report.orphanImageFiles).toContain("orphelin.jpg");
  });

  it("checkIntegrity() regroupe les doublons probables sans les supprimer", async () => {
    await seedSourceImage("file:///cache/h1.jpg");
    await seedSourceImage("file:///cache/h2.jpg");
    const a = await addExample({ sourceImageUri: "file:///cache/h1.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: draft() });
    const b = await addExample({ sourceImageUri: "file:///cache/h2.jpg", qualityWarnings: NO_WARNINGS, qualitySignals: QUALITY_SIGNALS, orientation: ORIENTATION, groundTruth: draft() });

    const report = await checkIntegrity();
    const group = report.duplicateGroups.find((g) => g.includes(a.example.id) && g.includes(b.example.id));
    expect(group).toBeDefined();
  });
});
