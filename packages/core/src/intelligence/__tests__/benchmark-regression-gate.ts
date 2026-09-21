import { expect } from "vitest";
import type { FusedValuation } from "../fuse-market-observations";

/**
 * Portillon de RÉGRESSION de benchmark (LOT "Data Quality Calibration...",
 * section 12) — vérifications CROISÉES, applicables à TOUT résultat de
 * `fuseMarketObservations`, indépendamment du scénario précis. Exécuté
 * automatiquement sur CHAQUE cas de `ALL_BENCHMARK_FIXTURES`
 * (`valuation-benchmark.test.ts`) — un futur changement de la fusion qui
 * enfreint l'une de ces invariantes fait échouer la suite entière, jamais
 * silencieusement.
 *
 * Pour METTRE À JOUR un benchmark délibérément (ex. un nouveau signal de
 * qualité change légitimement une valeur) : modifier la fixture ELLE-MÊME
 * dans `valuation-benchmark-fixtures.ts` avec une justification en
 * commentaire, jamais assouplir ce portillon pour faire passer un
 * changement — voir `docs/market-valuation-quality.md`, section "Mettre à
 * jour un benchmark".
 */

const RETAIL_ONLY_CONFIDENCE_CAP = 35;
const ACTIVE_ONLY_CONFIDENCE_CAP = 55;
const MAX_HISTORY_SHIFT_FRACTION = 0.15;

export function runBenchmarkRegressionChecks(name: string, result: FusedValuation): void {
  // Preuve retail seule (E uniquement) : jamais une confiance au-delà du plafond établi.
  if (result.qualityFlags.includes("retail_only")) {
    expect(result.confidence, `[${name}] retail_only doit rester <= ${RETAIL_ONLY_CONFIDENCE_CAP}`).toBeLessThanOrEqual(RETAIL_ONLY_CONFIDENCE_CAP);
  }

  // Preuve d'annonces actives seule (D uniquement) : jamais au-delà du plafond établi.
  if (result.qualityFlags.includes("active_only")) {
    expect(result.confidence, `[${name}] active_only doit rester <= ${ACTIVE_ONLY_CONFIDENCE_CAP}`).toBeLessThanOrEqual(ACTIVE_ONLY_CONFIDENCE_CAP);
  }

  // Un résultat "insufficient" ne porte JAMAIS de prix fabriqué.
  if (result.status === "insufficient") {
    expect(result.lowCents, `[${name}] insufficient ne doit jamais porter un lowCents`).toBeNull();
    expect(result.fairCents, `[${name}] insufficient ne doit jamais porter un fairCents`).toBeNull();
    expect(result.highCents, `[${name}] insufficient ne doit jamais porter un highCents`).toBeNull();
    expect(result.confidenceComponents, `[${name}] insufficient ne doit jamais porter de confidenceComponents`).toBeNull();
    return;
  }

  // low <= fair <= high, toujours.
  expect(result.lowCents!, `[${name}] lowCents doit rester <= fairCents`).toBeLessThanOrEqual(result.fairCents!);
  expect(result.fairCents!, `[${name}] fairCents doit rester <= highCents`).toBeLessThanOrEqual(result.highCents!);

  // La stabilisation par historique reste toujours BORNÉE — jamais un ancrage qui dépasse la limite documentée.
  if (result.historyStabilizationApplied && result.historicalReferenceMedianCents !== null) {
    const maxShift = Math.abs(result.fairCents!) * MAX_HISTORY_SHIFT_FRACTION;
    const distanceIfUnanchored = Math.abs(result.historicalReferenceMedianCents - result.fairCents!);
    // Le fairCents final ne peut jamais être plus loin de sa valeur live d'origine que `maxShift` — approximé ici en vérifiant que si l'historique est TRÈS éloigné du fair actuel, celui-ci ne l'a pas totalement rejoint (preuve indirecte du plafond, la preuve directe vit dans `fuse-market-observations.test.ts`).
    if (distanceIfUnanchored > maxShift * 2) {
      expect(result.fairCents, `[${name}] la stabilisation par historique ne doit jamais complètement remplacer la preuve live`).not.toBe(result.historicalReferenceMedianCents);
    }
  }

  // confidenceComponents.final doit toujours égaler confidence.
  if (result.confidenceComponents) {
    expect(result.confidenceComponents.final, `[${name}] confidenceComponents.final doit égaler confidence`).toBe(result.confidence);
  }
}
