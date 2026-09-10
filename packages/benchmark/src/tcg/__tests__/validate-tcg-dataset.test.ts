import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateTcgDataset } from "../validate-tcg-dataset";

let dir: string;

function writeDataset(entries: unknown[], overrides: Partial<{ provenance: string }> = {}) {
  writeFileSync(path.join(dir, "dataset.json"), JSON.stringify({ provenance: overrides.provenance ?? "real", entries }));
}

function writePhoto(relativePath: string) {
  const full = path.join(dir, relativePath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, "fake-jpeg-bytes");
}

function baseEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "nymble-096",
    imagePath: "photos/nymble-096.jpg",
    game: "pokemon",
    cardName: "Nymble",
    setName: "Phantasmal Flames",
    collectorNumber: "096",
    language: "en",
    variant: null,
    productKind: "raw_card",
    gradingCompany: null,
    grade: null,
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tcg-dataset-validate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("validateTcgDataset — VALID", () => {
  it("dataset bien formé, image présente : VALID, aucun problème", () => {
    writePhoto("photos/nymble-096.jpg");
    writeDataset([baseEntry()]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("VALID");
    expect(report.issues).toEqual([]);
    expect(report.entryCount).toBe(1);
  });
});

describe("validateTcgDataset — INVALID", () => {
  it("JSON structurellement invalide (hors schéma) : INVALID, SCHEMA_INVALID", () => {
    writeFileSync(path.join(dir, "dataset.json"), JSON.stringify({ provenance: "real", entries: [{ id: "x" }] }));
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("INVALID");
    expect(report.issues[0]!.code).toBe("SCHEMA_INVALID");
  });

  it("image référencée absente du disque : INVALID, IMAGE_MISSING", () => {
    writeDataset([baseEntry()]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("INVALID");
    expect(report.issues.some((i) => i.code === "IMAGE_MISSING")).toBe(true);
  });

  it("extension non supportée : INVALID, UNSUPPORTED_EXTENSION", () => {
    writePhoto("photos/nymble-096.webp");
    writeDataset([baseEntry({ imagePath: "photos/nymble-096.webp" })]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.issues.some((i) => i.code === "UNSUPPORTED_EXTENSION")).toBe(true);
  });

  it("ids dupliqués : INVALID, DUPLICATE_ID", () => {
    writePhoto("photos/a.jpg");
    writePhoto("photos/b.jpg");
    writeDataset([baseEntry({ imagePath: "photos/a.jpg" }), baseEntry({ imagePath: "photos/b.jpg" })]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("INVALID");
    expect(report.issues.some((i) => i.code === "DUPLICATE_ID")).toBe(true);
  });

  it("collision de fichier (deux ids différents pointent vers la même image) : INVALID, IMAGE_PATH_COLLISION", () => {
    writePhoto("photos/shared.jpg");
    writeDataset([baseEntry({ id: "a", imagePath: "photos/shared.jpg" }), baseEntry({ id: "b", imagePath: "photos/shared.jpg" })]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("INVALID");
    expect(report.issues.some((i) => i.code === "IMAGE_PATH_COLLISION")).toBe(true);
  });

  it("chemin d'image absolu ou avec traversée \"..\" : INVALID, UNSAFE_IMAGE_PATH", () => {
    writeDataset([baseEntry({ imagePath: "../outside.jpg" })]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("INVALID");
    expect(report.issues.some((i) => i.code === "UNSAFE_IMAGE_PATH")).toBe(true);
  });
});

describe("validateTcgDataset — WARNING (jamais bloquant)", () => {
  it("setName et collectorNumber tous deux null : WARNING, INCOMPLETE_GROUND_TRUTH", () => {
    writePhoto("photos/nymble-096.jpg");
    writeDataset([baseEntry({ setName: null, collectorNumber: null })]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("WARNING");
    expect(report.issues.some((i) => i.code === "INCOMPLETE_GROUND_TRUTH")).toBe(true);
  });

  it("fichier image présent mais référencé par aucune entrée : WARNING, ORPHAN_IMAGE_FILE", () => {
    writePhoto("photos/nymble-096.jpg");
    writePhoto("photos/orphelin.jpg");
    writeDataset([baseEntry()]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.status).toBe("WARNING");
    expect(report.issues.some((i) => i.code === "ORPHAN_IMAGE_FILE" && i.message.includes("orphelin.jpg"))).toBe(true);
  });

  it("doublon probable même avec un numéro de collection différemment paddé (096 vs 96) : WARNING, PROBABLE_DUPLICATE (jamais une comparaison de texte brute)", () => {
    writePhoto("photos/a.jpg");
    writePhoto("photos/b.jpg");
    writeDataset([
      baseEntry({ id: "a", imagePath: "photos/a.jpg", collectorNumber: "096" }),
      baseEntry({ id: "b", imagePath: "photos/b.jpg", collectorNumber: "96" }),
    ]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    const dup = report.issues.find((i) => i.code === "PROBABLE_DUPLICATE");
    expect(dup).toBeDefined();
    expect(dup!.message).toContain("a");
    expect(dup!.message).toContain("b");
  });

  it("deux cartes avec des numéros de collection réellement différents ne sont jamais signalées comme doublon", () => {
    writePhoto("photos/a.jpg");
    writePhoto("photos/b.jpg");
    writeDataset([
      baseEntry({ id: "a", imagePath: "photos/a.jpg", collectorNumber: "96" }),
      baseEntry({ id: "b", imagePath: "photos/b.jpg", collectorNumber: "97" }),
    ]);
    const report = validateTcgDataset(path.join(dir, "dataset.json"));
    expect(report.issues.some((i) => i.code === "PROBABLE_DUPLICATE")).toBe(false);
    expect(report.status).toBe("VALID");
  });
});
