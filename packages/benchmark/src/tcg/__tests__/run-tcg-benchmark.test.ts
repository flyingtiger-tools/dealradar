import { describe, expect, it } from "vitest";
import { runTcgBenchmark } from "../run-tcg-benchmark";
import type { TcgDataset } from "../dataset-schema";

function dataset(): TcgDataset {
  return {
    provenance: "synthetic",
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
        tags: ["perfect"],
      },
    ],
  };
}

describe("runTcgBenchmark — COÛT = 0 par défaut", () => {
  it("mode simulé par défaut : aucune clé requise, un résultat par entrée de matrice", async () => {
    const report = await runTcgBenchmark(
      dataset(),
      [
        { provider: "openai", model: "gpt-4o-mini" },
        { provider: "groq", model: "llama-3.3-70b-versatile" },
      ],
      { resolveImageUrl: (imagePath) => `file://${imagePath}` },
    );

    expect(report.mode).toBe("simulated");
    expect(report.matrices).toHaveLength(2);
    expect(report.datasetEntryCount).toBe(1);
    expect(report.matrices[0]!.matrixEntry.provider).toBe("openai");
    expect(report.matrices[1]!.matrixEntry.provider).toBe("groq");
  });

  it("documente honnêtement l'absence d'extracteur déterministe pour les cartes TCG", async () => {
    const report = await runTcgBenchmark(dataset(), [{ provider: "openai", model: "gpt-4o-mini" }], {
      resolveImageUrl: (imagePath) => `file://${imagePath}`,
    });

    expect(report.deterministicVsAi.deterministicSuccessRate).toBe(0);
    expect(report.deterministicVsAi.aiContributionRate).toBe(1);
    expect(report.deterministicVsAi.note.length).toBeGreaterThan(0);
  });

  it("dataset vide : rapport valide, sans exception, métriques à zéro", async () => {
    const report = await runTcgBenchmark(
      { provenance: "synthetic", entries: [] },
      [{ provider: "openai", model: "gpt-4o-mini" }],
      { resolveImageUrl: (imagePath) => `file://${imagePath}` },
    );
    expect(report.matrices[0]!.examplesTotal).toBe(0);
  });
});
