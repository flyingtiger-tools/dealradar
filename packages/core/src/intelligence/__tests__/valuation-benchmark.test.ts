import { describe, expect, it } from "vitest";
import { fuseMarketObservations } from "../fuse-market-observations";
import {
  ALL_BENCHMARK_FIXTURES,
  IPHONE_BENCHMARK,
  GAMING_CONSOLE_BENCHMARK,
  LEGO_BENCHMARK,
  SNEAKER_BENCHMARK,
  WATCH_BENCHMARK,
  COLLECTIBLE_RETAIL_ONLY_BENCHMARK,
  TCG_ADJACENT_BENCHMARK,
} from "./valuation-benchmark-fixtures";
import { runBenchmarkRegressionChecks } from "./benchmark-regression-gate";

/**
 * Suite de BENCHMARK déterministe (LOT "Data Quality Calibration...",
 * sections 1/12) — chaque cas encode un SCÉNARIO réel (bonne/mauvaise
 * variante, preuve spécialiste vs retail, duplication de marchand,
 * valeurs aberrantes, panne de source, preuve périmée) et vérifie que le
 * moteur de fusion se comporte comme attendu LOGIQUEMENT à partir de la
 * fixture elle-même — jamais un prix "correct" choisi arbitrairement.
 *
 * `runBenchmarkRegressionChecks` (section 12) s'exécute sur CHAQUE cas —
 * un futur changement de la fusion qui casse une invariante croisée
 * (plafond retail-only, low<=fair<=high, etc.) fait échouer cette suite.
 */
describe("benchmark de valorisation — portillon de régression croisé", () => {
  for (const fixture of ALL_BENCHMARK_FIXTURES) {
    it(`[${fixture.name}] passe le portillon de régression croisé`, () => {
      const result = fuseMarketObservations(fixture.observations, { asOf: fixture.asOf, target: fixture.target });
      runBenchmarkRegressionChecks(fixture.name, result);
    });
  }
});

describe("benchmark — iPhone / électronique", () => {
  const result = fuseMarketObservations(IPHONE_BENCHMARK.observations, { asOf: IPHONE_BENCHMARK.asOf, target: IPHONE_BENCHMARK.target });

  it("la variante 256GB (fausse) est exclue, jamais fusionnée", () => {
    expect(result.status).toBe("estimated");
    expect(result.evidenceCount).toBeLessThan(IPHONE_BENCHMARK.observations.length);
    expect(result.qualityFlags).toContain("variant_conflict_filtered");
  });

  it("la preuve spécialiste (Keepa, B) domine la preuve retail (Google Shopping, E) bien plus chère", () => {
    expect(result.fairCents!).toBeLessThan(60000); // bien plus proche de 50000 (B) que de 70000 (E).
  });
});

describe("benchmark — console de jeu", () => {
  const result = fuseMarketObservations(GAMING_CONSOLE_BENCHMARK.observations, { asOf: GAMING_CONSOLE_BENCHMARK.asOf, target: GAMING_CONSOLE_BENCHMARK.target });

  it("la diversité de source AIDE, mais un marchand dupliqué via deux connecteurs ne compte jamais deux fois", () => {
    expect(result.qualityFlags).toContain("duplicated_origin_merged");
    // digitec.ch compte comme UNE seule origine malgré deux connecteurs.
    expect(result.sourceCount).toBeLessThan(new Set(GAMING_CONSOLE_BENCHMARK.observations.map((o) => o.source)).size + 1);
  });

  it("l'accessoire (variante incorrecte) est exclu", () => {
    expect(result.qualityFlags).toContain("variant_conflict_filtered");
  });

  it("la valeur aberrante isolée ne domine jamais la fourchette", () => {
    expect(result.highCents!).toBeLessThan(150000);
  });
});

describe("benchmark — set LEGO", () => {
  const result = fuseMarketObservations(LEGO_BENCHMARK.observations, { asOf: LEGO_BENCHMARK.asOf, target: LEGO_BENCHMARK.target });

  it("l'annonce occasion (condition incompatible) est exclue de l'estimation scellée", () => {
    expect(result.status).toBe("estimated");
    expect(result.qualityFlags).toContain("variant_conflict_filtered");
  });

  it("la preuve périmée (6 mois) pèse beaucoup moins que la preuve fraîche à palier égal", () => {
    // Sans la preuve périmée, la fourchette resterait proche de 18000-19000 — la valeur périmée (9000) ne doit pas tirer `low` significativement en dessous.
    expect(result.lowCents!).toBeGreaterThan(14000);
  });
});

describe("benchmark — sneaker", () => {
  const result = fuseMarketObservations(SNEAKER_BENCHMARK.observations, { asOf: SNEAKER_BENCHMARK.asOf, target: SNEAKER_BENCHMARK.target });

  it("mauvaise taille ET condition portée sont toutes deux exclues", () => {
    expect(result.status).toBe("estimated");
    expect(result.qualityFlags).toContain("variant_conflict_filtered");
    expect(result.evidenceCount).toBe(3); // 5 observations - 2 exclues (mauvaise taille + portée).
  });
});

describe("benchmark — montre (désaccord spécialiste)", () => {
  const result = fuseMarketObservations(WATCH_BENCHMARK.observations, { asOf: WATCH_BENCHMARK.asOf, target: WATCH_BENCHMARK.target });

  it("preuve B contradictoire de haute qualité RÉDUIT la confiance, jamais moyennée en silence", () => {
    expect(result.status).toBe("estimated");
    expect(result.qualityFlags).toContain("high_dispersion");
  });
});

describe("benchmark — objet collectible, retail seul", () => {
  const result = fuseMarketObservations(COLLECTIBLE_RETAIL_ONLY_BENCHMARK.observations, {
    asOf: COLLECTIBLE_RETAIL_ONLY_BENCHMARK.asOf,
    target: COLLECTIBLE_RETAIL_ONLY_BENCHMARK.target,
  });

  it("preuve retail UNIQUEMENT : confiance basse, jamais présentée comme fiable pour la revente", () => {
    expect(result.status).toBe("estimated");
    expect(result.strongestTier).toBe("E");
    expect(result.qualityFlags).toContain("retail_only");
    expect(result.confidence).toBeLessThanOrEqual(35);
  });
});

describe("benchmark — cas TCG-adjacent (moteur générique uniquement, jamais le pipeline TCG réel)", () => {
  const result = fuseMarketObservations(TCG_ADJACENT_BENCHMARK.observations, { asOf: TCG_ADJACENT_BENCHMARK.asOf, target: TCG_ADJACENT_BENCHMARK.target });

  it("preuve spécialiste (B) domine la preuve marketplace (D) bien plus chère", () => {
    expect(result.status).toBe("estimated");
    expect(result.fairCents!).toBeLessThan(20000); // bien plus proche de ~12000 (B) que de ~25000 (D).
  });
});
