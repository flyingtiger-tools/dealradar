import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTcgCli } from "../cli-tcg";

let datasetsDir: string;

function writeTcgDataset() {
  const tcgDir = path.join(datasetsDir, "tcg");
  mkdirSync(path.join(tcgDir, "photos"), { recursive: true });
  writeFileSync(path.join(tcgDir, "photos", "nymble-096.jpg"), "fake-jpeg-bytes");
  writeFileSync(
    path.join(tcgDir, "tcg.json"),
    JSON.stringify({
      provenance: "real",
      entries: [
        {
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
        },
      ],
    }),
  );
}

beforeEach(() => {
  datasetsDir = mkdtempSync(path.join(tmpdir(), "tcg-cli-"));
  writeTcgDataset();
});

afterEach(() => {
  rmSync(datasetsDir, { recursive: true, force: true });
});

/**
 * Phase 16/17, "long lot local" : preuve que `--tcg-live` seul est REFUSÉ
 * avant tout chargement de dataset ou appel réseau — objectif explicite,
 * rendre impossible un run payant lancé par erreur. Aucun de ces tests ne
 * fournit de clé API réelle dans l'environnement ; même les cas qui passent
 * les garde-fous retombent en mode simulé (voir `provider-matrix.ts`), donc
 * aucun appel réseau n'a jamais lieu ici non plus.
 */
describe("runTcgCli — garde-fous --tcg-live (jamais exécuté réellement dans ces tests)", () => {
  it("--tcg-live seul (sans --confirm-live-cost ni --tcg-max-examples) : live_blocked, dataset jamais chargé", async () => {
    const result = await runTcgCli(["--tcg", "--tcg-live"], datasetsDir);
    expect(result.kind).toBe("live_blocked");
    if (result.kind === "live_blocked") {
      expect(result.reasons.some((r) => r.includes("--confirm-live-cost"))).toBe(true);
      expect(result.reasons.some((r) => r.includes("--tcg-max-examples"))).toBe(true);
    }
  });

  it("--tcg-live --confirm-live-cost seul (sans --tcg-max-examples) : live_blocked", async () => {
    const result = await runTcgCli(["--tcg", "--tcg-live", "--confirm-live-cost"], datasetsDir);
    expect(result.kind).toBe("live_blocked");
    if (result.kind === "live_blocked") {
      expect(result.reasons.some((r) => r.includes("--tcg-max-examples"))).toBe(true);
      expect(result.reasons.some((r) => r.includes("--confirm-live-cost"))).toBe(false);
    }
  });

  it("--tcg-live --tcg-max-examples=0 (invalide, pas strictement positif) : live_blocked", async () => {
    const result = await runTcgCli(["--tcg", "--tcg-live", "--confirm-live-cost", "--tcg-max-examples=0"], datasetsDir);
    expect(result.kind).toBe("live_blocked");
  });

  it("--tcg-live --tcg-max-examples=abc (non numérique) : live_blocked", async () => {
    const result = await runTcgCli(["--tcg", "--tcg-live", "--confirm-live-cost", "--tcg-max-examples=abc"], datasetsDir);
    expect(result.kind).toBe("live_blocked");
  });

  it("--tcg-live --confirm-live-cost --tcg-max-examples=1 (les deux garde-fous réunis) : jamais bloqué — mais aucune clé réelle en environnement de test, donc repli automatique sur le mode simulé (aucun appel réseau)", async () => {
    const result = await runTcgCli(["--tcg", "--tcg-live", "--confirm-live-cost", "--tcg-max-examples=1"], datasetsDir);
    expect(result.kind).toBe("report");
    if (result.kind === "report") {
      expect(result.report.mode).toBe("simulated"); // repli : OPENAI_API_KEY etc. absents de l'environnement de test
      expect(result.report.examplesEvaluatedCount).toBe(1);
    }
  });

  it("sans --tcg-live : --tcg-max-examples ignoré pour le garde-fou (mode simulé normal, mais toujours honoré comme plafond)", async () => {
    const result = await runTcgCli(["--tcg", "--tcg-max-examples=1"], datasetsDir);
    expect(result.kind).toBe("report");
    if (result.kind === "report") {
      expect(result.report.mode).toBe("simulated");
      expect(result.report.examplesEvaluatedCount).toBe(1);
    }
  });

  it("--tcg simple (sans --tcg-live) : jamais bloqué, comportement historique inchangé", async () => {
    const result = await runTcgCli(["--tcg"], datasetsDir);
    expect(result.kind).toBe("report");
  });
});
