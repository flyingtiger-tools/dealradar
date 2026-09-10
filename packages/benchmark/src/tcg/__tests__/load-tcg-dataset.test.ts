import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadTcgDataset, resolveTcgImagePath, TcgDatasetValidationError } from "../load-tcg-dataset";

function writeTempDataset(content: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tcg-dataset-"));
  const filePath = path.join(dir, "dataset.json");
  writeFileSync(filePath, JSON.stringify(content), "utf8");
  return filePath;
}

describe("loadTcgDataset", () => {
  it("charge un dataset valide", () => {
    const filePath = writeTempDataset({ provenance: "synthetic", entries: [] });
    expect(loadTcgDataset(filePath).provenance).toBe("synthetic");
  });

  it("JSON invalide : lève TcgDatasetValidationError, jamais une exception brute", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tcg-dataset-"));
    const filePath = path.join(dir, "dataset.json");
    writeFileSync(filePath, "not-json{{{", "utf8");
    expect(() => loadTcgDataset(filePath)).toThrow(TcgDatasetValidationError);
  });

  it("schéma invalide (champ requis manquant) : lève TcgDatasetValidationError", () => {
    const filePath = writeTempDataset({ provenance: "synthetic" });
    expect(() => loadTcgDataset(filePath)).toThrow(TcgDatasetValidationError);
  });

  it("fichier introuvable : lève TcgDatasetValidationError, jamais une exception fs brute", () => {
    expect(() => loadTcgDataset("/chemin/qui/n-existe-pas/dataset.json")).toThrow(TcgDatasetValidationError);
  });
});

describe("resolveTcgImagePath", () => {
  it("résout le chemin relatif à l'image par rapport au répertoire du dataset, jamais au cwd", () => {
    const resolved = resolveTcgImagePath("/data/tcg/dataset.json", "photos/nymble-096.jpg");
    expect(resolved).toBe(path.resolve("/data/tcg", "photos/nymble-096.jpg"));
  });
});
