import type { FusionObservation, FusionTarget, EvidenceQualityTier } from "../fuse-market-observations";

/**
 * Fixtures de BENCHMARK déterministes (LOT "Data Quality Calibration...",
 * sections 1/12) — réutilisées par `valuation-benchmark.test.ts` (les
 * assertions elles-mêmes) et par tout futur test qui voudrait rejouer le
 * même scénario. Jamais de prix "correct" choisi arbitrairement au-delà
 * de ce que le scénario implique logiquement (règle explicite du lot) :
 * chaque cas encode une INTENTION de test précise (variante fausse,
 * preuve retail seule, etc.), jamais un chiffre pour faire "joli".
 */
const ASOF = "2026-09-21T00:00:00.000Z";

function daysAgo(days: number): string {
  return new Date(Date.parse(ASOF) - days * 24 * 60 * 60 * 1000).toISOString();
}

function obs(overrides: Partial<FusionObservation> & { source: string; priceCents: number; evidenceTier: EvidenceQualityTier }): FusionObservation {
  return {
    sourceItemId: overrides.sourceItemId ?? `${overrides.source}-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? "item",
    currency: overrides.currency ?? "CHF",
    observedAt: overrides.observedAt ?? ASOF,
    matchScore: overrides.matchScore ?? 1,
    condition: overrides.condition ?? null,
    completeness: overrides.completeness ?? null,
    attributes: overrides.attributes ?? {},
    ...overrides,
  };
}

export interface BenchmarkFixture {
  name: string;
  target: FusionTarget;
  observations: FusionObservation[];
  asOf: string;
}

// ------------------------------------------------------------
// 1. iPhone / électronique — variante stockage correcte/incorrecte,
//    spécialiste (Keepa, B), annonces actives (eBay, D), retail (Google
//    Shopping, E), une source en panne totale (aucune observation
//    n'existe pour "bricklink" — jamais représentée, une panne EST une
//    absence, jamais une observation fabriquée à zéro).
// ------------------------------------------------------------
export const IPHONE_BENCHMARK: BenchmarkFixture = {
  name: "iphone_13_128gb",
  target: { currency: "CHF", condition: "very_good", attributes: { storageGb: 128 } },
  observations: [
    obs({ source: "keepa", evidenceTier: "B", priceCents: 50000, condition: "very_good", attributes: { storageGb: 128 } }),
    obs({ source: "keepa", sourceItemId: "keepa-2", evidenceTier: "B", priceCents: 51000, condition: "very_good", attributes: { storageGb: 128 } }),
    obs({ source: "ebay", evidenceTier: "D", priceCents: 48000, condition: "very_good", attributes: { storageGb: 128 } }),
    obs({ source: "ebay", sourceItemId: "ebay-2", evidenceTier: "D", priceCents: 49500, condition: "very_good", attributes: { storageGb: 128 } }),
    obs({ source: "google_shopping", evidenceTier: "E", priceCents: 70000, condition: "new", attributes: { storageGb: 128 } }),
    // Variante INCORRECTE (256GB) — doit être exclue, jamais fusionnée.
    obs({ source: "ebay", sourceItemId: "ebay-wrong-variant", evidenceTier: "D", priceCents: 65000, condition: "very_good", attributes: { storageGb: 256 } }),
  ],
  asOf: ASOF,
};

// ------------------------------------------------------------
// 2. Console de jeu — duplication de marchand via deux connecteurs
//    (Google Shopping + DataForSEO reflétant le MÊME marchand "digitec.ch"),
//    valeur aberrante isolée, condition manquante sur une partie de la
//    preuve.
// ------------------------------------------------------------
export const GAMING_CONSOLE_BENCHMARK: BenchmarkFixture = {
  name: "ps5_console",
  target: { currency: "CHF", attributes: { productType: "console" } },
  observations: [
    obs({ source: "ebay", evidenceTier: "D", priceCents: 40000, attributes: { productType: "console" } }),
    obs({ source: "ebay", sourceItemId: "ebay-2", evidenceTier: "D", priceCents: 40500, attributes: { productType: "console" } }),
    obs({ source: "ebay", sourceItemId: "ebay-3", evidenceTier: "D", priceCents: 39500, condition: null, attributes: { productType: "console" } }),
    // Même marchand réel via deux connecteurs distincts — ne doit jamais compter double.
    obs({ source: "google_shopping", merchant: "digitec.ch", evidenceTier: "E", priceCents: 42000, attributes: { productType: "console" } }),
    obs({ source: "dataforseo_google_shopping", merchant: "digitec.ch", evidenceTier: "E", priceCents: 42100, attributes: { productType: "console" } }),
    // Valeur aberrante isolée (annonce mal catégorisée mais même variante déclarée).
    obs({ source: "ebay", sourceItemId: "ebay-outlier", evidenceTier: "D", priceCents: 150000, attributes: { productType: "console" } }),
    // Accessoire seul — variante incorrecte, doit être exclue.
    obs({ source: "ebay", sourceItemId: "ebay-controller", evidenceTier: "D", priceCents: 8000, attributes: { productType: "controller" } }),
  ],
  asOf: ASOF,
};

// ------------------------------------------------------------
// 3. Set LEGO — scellé vs occasion (condition canonique via
//    `condition-normalization.ts`), preuve spécialiste BrickLink (A),
//    preuve périmée (annonce vieille de 6 mois).
// ------------------------------------------------------------
export const LEGO_BENCHMARK: BenchmarkFixture = {
  name: "lego_10300",
  target: { currency: "CHF", condition: "new_sealed" },
  observations: [
    obs({ source: "bricklink", evidenceTier: "A", priceCents: 18000, condition: "new_sealed" }),
    obs({ source: "bricklink", sourceItemId: "bricklink-2", evidenceTier: "A", priceCents: 18500, condition: "new_sealed" }),
    obs({ source: "ebay", evidenceTier: "D", priceCents: 19000, condition: "new_sealed" }),
    // Occasion — variante de condition INCOMPATIBLE, doit être exclue.
    obs({ source: "ebay", sourceItemId: "ebay-used", evidenceTier: "D", priceCents: 12000, condition: "good" }),
    // Preuve PÉRIMÉE (6 mois) — pèse quasiment rien dans la fusion pondérée.
    obs({ source: "bricklink", sourceItemId: "bricklink-stale", evidenceTier: "A", priceCents: 9000, condition: "new_sealed", observedAt: daysAgo(180) }),
  ],
  asOf: ASOF,
};

// ------------------------------------------------------------
// 4. Sneaker — mauvaise taille (variante incorrecte), multi-devises
//    (USD converti vers CHF en amont par l'appelant — ici on ne fournit
//    QUE des observations déjà dans la devise cible, la fusion elle-même
//    ne convertit jamais ; le cas "toute autre devise écartée" est déjà
//    couvert par les tests dédiés de `fuse-market-observations.test.ts`).
// ------------------------------------------------------------
export const SNEAKER_BENCHMARK: BenchmarkFixture = {
  name: "sneaker_air_jordan_1",
  target: { currency: "CHF", condition: "new_sealed", attributes: { size: 42 } },
  observations: [
    obs({ source: "ebay", evidenceTier: "D", priceCents: 25000, condition: "new_sealed", attributes: { size: 42 } }),
    obs({ source: "ebay", sourceItemId: "ebay-2", evidenceTier: "D", priceCents: 26000, condition: "new_sealed", attributes: { size: 42 } }),
    obs({ source: "google_shopping", evidenceTier: "E", priceCents: 32000, condition: "new_sealed", attributes: { size: 42 } }),
    // Mauvaise taille — variante incorrecte.
    obs({ source: "ebay", sourceItemId: "ebay-wrong-size", evidenceTier: "D", priceCents: 22000, condition: "new_sealed", attributes: { size: 44 } }),
    // Portée — condition incompatible.
    obs({ source: "ebay", sourceItemId: "ebay-worn", evidenceTier: "D", priceCents: 12000, condition: "very_good", attributes: { size: 42 } }),
  ],
  asOf: ASOF,
};

// ------------------------------------------------------------
// 5. Montre — preuve spécialiste contradictoire (deux sources B en fort
//    désaccord) : doit pénaliser la confiance, jamais moyenner en
//    silence.
// ------------------------------------------------------------
export const WATCH_BENCHMARK: BenchmarkFixture = {
  name: "watch_specialist_disagreement",
  target: { currency: "CHF" },
  observations: [
    obs({ source: "watchcharts", evidenceTier: "B", priceCents: 800000 }),
    obs({ source: "ebay", sourceItemId: "ebay-1", evidenceTier: "B", priceCents: 2000000 }), // désaccord fort et volontaire.
    obs({ source: "ebay", sourceItemId: "ebay-2", evidenceTier: "D", priceCents: 850000 }),
  ],
  asOf: ASOF,
};

// ------------------------------------------------------------
// 6. Objet collectible/général — retail SEUL (palier E uniquement) :
//    confiance plafonnée bas, jamais présentée comme fiable pour de la
//    revente.
// ------------------------------------------------------------
export const COLLECTIBLE_RETAIL_ONLY_BENCHMARK: BenchmarkFixture = {
  name: "collectible_retail_only",
  target: { currency: "CHF" },
  observations: [
    obs({ source: "google_shopping", evidenceTier: "E", priceCents: 15000 }),
    obs({ source: "dataforseo_google_shopping", merchant: "fnac.ch", evidenceTier: "E", priceCents: 15200 }),
    obs({ source: "google_shopping", merchant: "galaxus.ch", sourceItemId: "gs-2", evidenceTier: "E", priceCents: 14800 }),
  ],
  asOf: ASOF,
};

// ------------------------------------------------------------
// 7. TCG-adjacent — reproduit la FORME d'un scénario carte à collectionner
//    (agrégateur de prix spécialisé = B, marketplace active = D) SANS
//    jamais toucher/importer le pipeline TCG réel (`orchestrate-pokemon-
//    pipeline.ts`, `process-tcg-card-analysis.ts` et les connecteurs
//    TCG-spécifiques restent intacts, non référencés ici) — uniquement le
//    moteur de fusion GÉNÉRIQUE, avec des données représentatives.
// ------------------------------------------------------------
export const TCG_ADJACENT_BENCHMARK: BenchmarkFixture = {
  name: "tcg_adjacent_specialist_dominates",
  target: { currency: "CHF" },
  observations: [
    obs({ source: "justtcg_like_aggregator", evidenceTier: "B", priceCents: 12000 }),
    obs({ source: "justtcg_like_aggregator", sourceItemId: "agg-2", evidenceTier: "B", priceCents: 12200 }),
    // Marketplace active bien plus chère — le spécialiste doit dominer.
    obs({ source: "ebay", evidenceTier: "D", priceCents: 25000 }),
    obs({ source: "ebay", sourceItemId: "ebay-2", evidenceTier: "D", priceCents: 26000 }),
  ],
  asOf: ASOF,
};

export const ALL_BENCHMARK_FIXTURES: readonly BenchmarkFixture[] = [
  IPHONE_BENCHMARK,
  GAMING_CONSOLE_BENCHMARK,
  LEGO_BENCHMARK,
  SNEAKER_BENCHMARK,
  WATCH_BENCHMARK,
  COLLECTIBLE_RETAIL_ONLY_BENCHMARK,
  TCG_ADJACENT_BENCHMARK,
];
