import type { TcgDataset } from "./dataset-schema";
import { buildProviderForMatrixEntry } from "./provider-matrix";
import { runTcgExample } from "./run-tcg-example";
import { aggregateTcgMatrixMetrics } from "./aggregate-tcg-metrics";
import type { ProviderMatrixEntry, TcgBenchmarkReport } from "./types";

export interface RunTcgBenchmarkOptions {
  /** Résout `imagePath` (relatif au dataset) vers une URL/URI passée au provider — jamais déréférencée en mode simulé. */
  resolveImageUrl: (imagePath: string) => string;
  /**
   * `true` uniquement si l'appelant a explicitement choisi un run réel ET
   * dispose d'une clé valide pour l'entrée de matrice concernée — voir
   * `provider-matrix.ts`. Par défaut (`false`/absent) : mode simulé
   * garanti, aucun appel réseau, quel que soit l'environnement.
   */
  live?: boolean;
}

/**
 * Exécute chaque exemple du dataset TCG pour chaque entrée de la matrice
 * provider/modèle, sur exactement le même jeu de données (Phase 6, ADR
 * 0013) — jamais un sous-ensemble différent par entrée. `deterministicVsAi`
 * documente honnêtement l'absence actuelle d'extracteur déterministe
 * photo -> texte pour les cartes TCG (voir `types.ts`).
 */
export async function runTcgBenchmark(
  dataset: TcgDataset,
  matrix: readonly ProviderMatrixEntry[],
  options: RunTcgBenchmarkOptions,
): Promise<TcgBenchmarkReport> {
  let anyLive = false;
  const matrices = [];

  for (const matrixEntry of matrix) {
    const built = buildProviderForMatrixEntry(matrixEntry, { live: options.live });
    if (built.mode === "live") anyLive = true;

    const results = [];
    for (const entry of dataset.entries) {
      const imageUrl = options.resolveImageUrl(entry.imagePath);
      results.push(
        await runTcgExample(entry, {
          matrixEntry,
          provider: built.provider,
          imageUrl,
          imageStorageKey: `benchmark/${entry.id}`,
        }),
      );
    }

    matrices.push(aggregateTcgMatrixMetrics(matrixEntry, results));
  }

  return {
    generatedAt: new Date().toISOString(),
    datasetProvenance: dataset.provenance,
    datasetEntryCount: dataset.entries.length,
    mode: anyLive ? "live" : "simulated",
    matrices,
    deterministicVsAi: {
      deterministicSuccessRate: 0,
      aiContributionRate: 1,
      note:
        "Aucun extracteur déterministe (OCR/code-barres) n'existe aujourd'hui pour une photo de carte TCG (ADR 0013, étape 1 non implémentée) — 100% des exemples de ce dataset passent nécessairement par l'IA. Cette valeur deviendra non triviale une fois un extracteur déterministe ajouté.",
    },
  };
}
