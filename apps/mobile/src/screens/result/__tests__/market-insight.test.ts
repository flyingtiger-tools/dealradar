import { buildMarketInsight } from "../market-insight";
import type { MarketEvidence } from "@dealradar/contracts";

/**
 * QA hardening (LOT "Product History UX + Source Health + Interactive
 * Cancellation + Beta Readiness", section 8) — audite `buildMarketInsight`
 * (module PARTAGÉ par les deux mappers, voir son en-tête) contre les états
 * limites listés par le lot : confiance basse, retail-only, active-only,
 * historique clairsemé, 1 vs plusieurs sources, tendance absente, fourchette
 * de prix extrême, aucun historique. Pas de bibliothèque de rendu React
 * Native dans ce repo (voir `result-screen-structure.test.ts`) — cette
 * fonction pure est le seul point d'entrée testable sans monter
 * `MarketInsightCard` lui-même.
 */

function baseEvidence(overrides: Partial<MarketEvidence> = {}): MarketEvidence {
  return {
    strongestTier: "A",
    sourceCount: 3,
    observationCount: 5,
    liveObservationCount: 0,
    historicalObservationCount: 5,
    sourceNames: ["ebay", "bricklink"],
    retailOnlyWarning: false,
    activeListingsOnlyWarning: false,
    usedSpecialistHistory: false,
    ...overrides,
  };
}

describe("buildMarketInsight — absence d'évidence", () => {
  it("evidence undefined : retourne null, jamais un résumé inventé à partir de champs partiels", () => {
    expect(buildMarketInsight({ evidence: undefined, fairValueLowCents: 100, fairValueHighCents: 200, currency: "CHF", confidencePercent: 50 })).toBeNull();
  });
});

describe("buildMarketInsight — confiance basse", () => {
  it("confidencePercent bas (ex. 5) transmis tel quel, jamais arrondi/masqué", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence(), fairValueLowCents: 100, fairValueHighCents: 200, currency: "CHF", confidencePercent: 5 });
    expect(insight?.confidencePercent).toBe(5);
  });

  it("confidencePercent null (aucun score disponible) : jamais une valeur inventée (0 par défaut)", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence(), fairValueLowCents: 100, fairValueHighCents: 200, currency: "CHF", confidencePercent: null });
    expect(insight?.confidencePercent).toBeNull();
  });
});

describe("buildMarketInsight — retail-only / active-only (mutuellement significatifs, jamais combinés)", () => {
  it("retailOnlyWarning true : reporté tel quel, activeListingOnlyWarning reste false", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ retailOnlyWarning: true, activeListingsOnlyWarning: false, strongestTier: "E" }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 40,
    });
    expect(insight?.retailOnlyWarning).toBe(true);
    expect(insight?.activeListingOnlyWarning).toBe(false);
    expect(insight?.strongestEvidenceLabel).toBe("Prix neuf affiché");
  });

  it("activeListingsOnlyWarning true : reporté tel quel, retailOnlyWarning reste false", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ retailOnlyWarning: false, activeListingsOnlyWarning: true, strongestTier: "D" }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 40,
    });
    expect(insight?.retailOnlyWarning).toBe(false);
    expect(insight?.activeListingOnlyWarning).toBe(true);
    expect(insight?.strongestEvidenceLabel).toBe("Annonce en cours");
  });
});

describe("buildMarketInsight — historique clairsemé (sparse_history)", () => {
  it("qualityFlags contient sparse_history : traduit en libellé honnête, jamais le code brut", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ qualityFlags: ["sparse_history"] }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 30,
    });
    expect(insight?.qualityReasons).toEqual(["Peu d'historique de prix disponible"]);
  });

  it("qualityFlags avec un code inconnu : repli sur le code brut, jamais un crash", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ qualityFlags: ["code_futur_inconnu"] }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 30,
    });
    expect(insight?.qualityReasons).toEqual(["code_futur_inconnu"]);
  });

  it("qualityFlags dupliqués : dédupliqués après traduction, jamais la même raison répétée", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ qualityFlags: ["retail_only", "active_only", "retail_only"] }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 30,
    });
    expect(insight?.qualityReasons).toEqual(["Basé uniquement sur des prix neufs en boutique", "Basé sur des annonces en cours, aucune vente confirmée"]);
  });
});

describe("buildMarketInsight — 1 vs plusieurs sources", () => {
  it("sourceCount = 1 : transmis tel quel (la pluralisation \"source\"/\"sources\" est la responsabilité de MarketInsightCard, jamais recalculée ici)", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence({ sourceCount: 1 }), fairValueLowCents: 100, fairValueHighCents: 200, currency: "CHF", confidencePercent: 60 });
    expect(insight?.sourceCount).toBe(1);
  });

  it("sourceCount élevé (ex. 7, tous connecteurs) : transmis tel quel, jamais plafonné", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence({ sourceCount: 7 }), fairValueLowCents: 100, fairValueHighCents: 200, currency: "CHF", confidencePercent: 90 });
    expect(insight?.sourceCount).toBe(7);
  });
});

describe("buildMarketInsight — tendance absente / inconnue", () => {
  it("trendDescriptor absent : trendLabel null, jamais un libellé de tendance inventé", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence(), fairValueLowCents: 100, fairValueHighCents: 200, currency: "CHF", confidencePercent: 60 });
    expect(insight?.trendLabel).toBeNull();
    expect(insight?.trendDescriptor).toBeNull();
  });

  it("trendDescriptor 'insufficient' : libellé honnête dédié, jamais confondu avec 'flat'", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ trendDescriptor: "insufficient", trendConfidence: 10 }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 60,
    });
    expect(insight?.trendLabel).toBe("Historique insuffisant pour une tendance");
  });

  it("trendDescriptor inconnu (code futur non traduit) : repli sur le code brut, jamais un crash", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ trendDescriptor: "volatile" }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 60,
    });
    expect(insight?.trendLabel).toBe("volatile");
  });
});

describe("buildMarketInsight — fourchette de prix extrême", () => {
  it("fourchette très large (ex. 1 CHF à 50'000 CHF) : transmise telle quelle, jamais resserrée/arrondie différemment", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence(), fairValueLowCents: 100, fairValueHighCents: 5_000_000, currency: "CHF", confidencePercent: 60 });
    expect(insight?.fairValueLowCents).toBe(100);
    expect(insight?.fairValueHighCents).toBe(5_000_000);
  });

  it("fourchette entièrement absente (null/null) : jamais une valeur par défaut de 0", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence(), fairValueLowCents: null, fairValueHighCents: null, currency: null, confidencePercent: 60 });
    expect(insight?.fairValueLowCents).toBeNull();
    expect(insight?.fairValueHighCents).toBeNull();
    expect(insight?.currency).toBeNull();
  });
});

describe("buildMarketInsight — position prix actuel vs historique (aucun historique)", () => {
  it("currentVsHistoryPercentile absent : currentVsHistoryLabel null, jamais le mot 'percentile' ni une position devinée", () => {
    const insight = buildMarketInsight({ evidence: baseEvidence(), fairValueLowCents: 100, fairValueHighCents: 200, currency: "CHF", confidencePercent: 60 });
    expect(insight?.currentVsHistoryLabel).toBeNull();
    expect(insight?.currentVsHistoryPercentile).toBeNull();
  });

  it.each([
    [0, "Ce prix se situe parmi les plus bas observés historiquement"],
    [20, "Ce prix se situe parmi les plus bas observés historiquement"],
    [21, "Ce prix se situe dans la moyenne de l'historique connu"],
    [50, "Ce prix se situe dans la moyenne de l'historique connu"],
    [79, "Ce prix se situe dans la moyenne de l'historique connu"],
    [80, "Ce prix se situe parmi les plus élevés observés historiquement"],
    [100, "Ce prix se situe parmi les plus élevés observés historiquement"],
  ])("percentile %d -> libellé attendu (seuils larges 20/80, jamais une fausse précision)", (percentile, expected) => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ currentVsHistoryPercentile: percentile }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 60,
    });
    expect(insight?.currentVsHistoryLabel).toBe(expected);
  });
});

describe("buildMarketInsight — palier de preuve inconnu", () => {
  it("strongestTier inconnu (code futur non traduit) : repli sur le code brut, jamais 'Tier X' ni un crash", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ strongestTier: "F" as never }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 60,
    });
    expect(insight?.strongestEvidenceLabel).toBe("F");
  });

  it("strongestTier null : strongestEvidenceLabel null, jamais un libellé par défaut trompeur", () => {
    const insight = buildMarketInsight({
      evidence: baseEvidence({ strongestTier: null }),
      fairValueLowCents: 100,
      fairValueHighCents: 200,
      currency: "CHF",
      confidencePercent: 60,
    });
    expect(insight?.strongestEvidenceLabel).toBeNull();
  });
});
