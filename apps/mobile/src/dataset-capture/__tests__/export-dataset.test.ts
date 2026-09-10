let mockRandomUuidCounter = 0;
let mockSafGranted = false;

jest.mock("expo-crypto", () => ({
  randomUUID: () => `mock-uuid-${++mockRandomUuidCounter}`,
}));

jest.mock("expo-file-system", () => require("./fake-file-system").createFakeFileSystemModule({ get safGranted() { return mockSafGranted; } }));

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));

import * as FileSystem from "expo-file-system";
import { tcgDatasetSchema } from "@dealradar/contracts";
import { addExample } from "../storage";
import { buildExportDataset, buildExportZip, DatasetExportError, exportDataset } from "../export-dataset";
import { readStoredZipEntries } from "../zip-writer";
import { base64ToBytes, bytesToBase64 } from "../base64";
import { emptyGroundTruthDraft } from "../types";
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

async function seedExample(cardName: string) {
  await FileSystem.writeAsStringAsync(`file:///cache/${cardName}.jpg`, bytesToBase64(Uint8Array.from([1, 2, 3, 4, 5])));
  return addExample({
    sourceImageUri: `file:///cache/${cardName}.jpg`,
    qualityWarnings: NO_WARNINGS,
    qualitySignals: QUALITY_SIGNALS,
    orientation: ORIENTATION,
    groundTruth: { ...emptyGroundTruthDraft(), cardName, setName: "Phantasmal Flames", collectorNumber: "096" },
  });
}

describe("buildExportDataset — pur, aucune E/S", () => {
  it("produit un dataset qui passe tcgDatasetSchema (jamais un export que loadTcgDataset() refuserait)", () => {
    const dataset = buildExportDataset([
      {
        id: "ex-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        localImageUri: "file:///doc/tcg-dataset-capture/images/ex-1.jpg",
        qualityWarnings: [],
        qualitySignals: QUALITY_SIGNALS,
        orientation: ORIENTATION,
        groundTruth: { ...emptyGroundTruthDraft(), cardName: "Nymble", setName: "Phantasmal Flames", collectorNumber: "096", tags: ["leading_zero"] },
      },
    ]);

    expect(() => tcgDatasetSchema.parse(dataset)).not.toThrow();
    expect(dataset.provenance).toBe("real");
    expect(dataset.entries).toHaveLength(1);
    expect(dataset.entries[0]!.imagePath).toBe("photos/ex-1.jpg");
    expect(dataset.entries[0]!.id).toBe("ex-1");
    expect(dataset.entries[0]!.collectorNumber).toBe("096"); // valeur brute conservée, jamais normalisée à l'export
  });

  it("notes vides -> champ omis (jamais une chaîne vide écrite)", () => {
    const dataset = buildExportDataset([
      {
        id: "ex-2",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        localImageUri: "file:///doc/x.jpg",
        qualityWarnings: [],
        qualitySignals: QUALITY_SIGNALS,
        orientation: ORIENTATION,
        groundTruth: { ...emptyGroundTruthDraft(), cardName: "Carte", notes: "   " },
      },
    ]);
    expect(dataset.entries[0]!.notes).toBeUndefined();
  });
});

describe("exportDataset — orchestration disque (mock expo-file-system)", () => {
  beforeEach(() => {
    mockSafGranted = false;
  });

  it("sans exemple enregistré : DatasetExportError, jamais un ZIP vide silencieux", async () => {
    await expect(exportDataset()).rejects.toBeInstanceOf(DatasetExportError);
  });

  it("construit un ZIP contenant dataset.json + une photo par exemple, relu et vérifié par CRC", async () => {
    const a = await seedExample("Nymble");
    const b = await seedExample("Autre Carte");

    const result = await exportDataset();
    expect(result.exampleCount).toBe(2);
    expect(result.fileName).toMatch(/^dealradar-tcg-dataset-\d{8}\.zip$/);

    const zipBase64 = await FileSystem.readAsStringAsync(result.internalPath, { encoding: FileSystem.EncodingType.Base64 });
    const entries = readStoredZipEntries(base64ToBytes(zipBase64));
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(["dataset.json", `photos/${a.example.id}.jpg`, `photos/${b.example.id}.jpg`].sort());
    expect(entries.every((e) => e.crcValid)).toBe(true);
  });

  it("permission SAF accordée (Android) : savedToUserFolder true", async () => {
    await seedExample("Carte SAF Accordee");
    mockSafGranted = true;
    const result = await exportDataset();
    expect(result.savedToUserFolder).toBe(true);
  });

  it("permission SAF refusée : savedToUserFolder false, le ZIP reste disponible en interne (internalPath)", async () => {
    await seedExample("Carte SAF Refusee");
    mockSafGranted = false;
    const result = await exportDataset();
    expect(result.savedToUserFolder).toBe(false);
    await expect(FileSystem.getInfoAsync(result.internalPath)).resolves.toMatchObject({ exists: true });
  });
});

describe("buildExportZip — pur (hors orchestration SAF)", () => {
  it("lève si une image référencée par le manifest est absente du disque (jamais un ZIP avec une entrée manquante silencieuse)", async () => {
    const example = {
      id: "ex-missing",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      localImageUri: "file:///doc/tcg-dataset-capture/images/does-not-exist.jpg",
      qualityWarnings: [],
      qualitySignals: QUALITY_SIGNALS,
      orientation: ORIENTATION,
      groundTruth: { ...emptyGroundTruthDraft(), cardName: "Carte Fantome" },
    };
    await expect(buildExportZip([example])).rejects.toThrow();
  });
});
