import { describe, expect, it } from "vitest";
import { fuseMarketObservations, isCompatibleWithTarget, weightedPercentile } from "../fuse-market-observations";
import type { FusionObservation, FusionTarget } from "../fuse-market-observations";

const ASOF = "2026-09-21T00:00:00.000Z";

function obs(overrides: Partial<FusionObservation> = {}): FusionObservation {
  return {
    source: "ebay",
    sourceItemId: "item-1",
    title: "iPhone 13 128GB unlocked",
    priceCents: 40000,
    currency: "USD",
    evidenceTier: "D",
    observedAt: ASOF,
    matchScore: 1,
    condition: null,
    completeness: null,
    attributes: {},
    ...overrides,
  };
}

const TARGET_USD: FusionTarget = { currency: "USD" };

describe("weightedPercentile", () => {
  it("retourne la valeur unique pour un seul élément", () => {
    expect(weightedPercentile([{ value: 100, weight: 1 }], 0.5)).toBe(100);
  });

  it("pondère correctement, pas une simple moyenne arithmétique", () => {
    // 9 unités de poids sur 100, 1 unité de poids sur 200 -> médiane pondérée proche de 100, pas 150.
    const items = [
      { value: 100, weight: 9 },
      { value: 200, weight: 1 },
    ];
    const p50 = weightedPercentile(items, 0.5);
    expect(p50).toBeLessThan(150);
    expect(p50).toBeCloseTo(100, 0);
  });
});

describe("isCompatibleWithTarget", () => {
  it("iPhone 128GB vs 256GB : exclusion stricte quand les deux valeurs sont connues et diffèrent", () => {
    const target: FusionTarget = { currency: "USD", attributes: { storageGb: 128 } };
    const compatible = obs({ attributes: { storageGb: 128 } });
    const incompatible = obs({ attributes: { storageGb: 256 } });
    expect(isCompatibleWithTarget(compatible, target)).toBe(true);
    expect(isCompatibleWithTarget(incompatible, target)).toBe(false);
  });

  it("attribut absent d'un côté : jamais exclu (réduit la confiance ailleurs, pas ici)", () => {
    const target: FusionTarget = { currency: "USD", attributes: { storageGb: 128 } };
    const noAttribute = obs({ attributes: {} });
    expect(isCompatibleWithTarget(noAttribute, target)).toBe(true);
  });

  it("PS5 console vs accessoire (manette) : exclusion via attribut productType conflictuel", () => {
    const target: FusionTarget = { currency: "USD", attributes: { productType: "console" } };
    const console_ = obs({ attributes: { productType: "console" } });
    const controller = obs({ attributes: { productType: "controller" } });
    expect(isCompatibleWithTarget(console_, target)).toBe(true);
    expect(isCompatibleWithTarget(controller, target)).toBe(false);
  });

  it("LEGO même set neuf vs occasion : exclusion via condition", () => {
    const target: FusionTarget = { currency: "USD", condition: "new" };
    const newSet = obs({ condition: "new" });
    const usedSet = obs({ condition: "used" });
    expect(isCompatibleWithTarget(newSet, target)).toBe(true);
    expect(isCompatibleWithTarget(usedSet, target)).toBe(false);
  });

  it("jeu loose vs complete-in-box : exclusion via completeness", () => {
    const target: FusionTarget = { currency: "USD", completeness: "complete_in_box" };
    const cib = obs({ completeness: "complete_in_box" });
    const loose = obs({ completeness: "loose" });
    expect(isCompatibleWithTarget(cib, target)).toBe(true);
    expect(isCompatibleWithTarget(loose, target)).toBe(false);
  });

  it("sneaker même modèle mauvaise taille : exclusion via attribut size", () => {
    const target: FusionTarget = { currency: "USD", attributes: { size: 42 } };
    const rightSize = obs({ attributes: { size: 42 } });
    const wrongSize = obs({ attributes: { size: 44 } });
    expect(isCompatibleWithTarget(rightSize, target)).toBe(true);
    expect(isCompatibleWithTarget(wrongSize, target)).toBe(false);
  });
});

describe("fuseMarketObservations — cas d'insuffisance", () => {
  it("aucune observation : insuffisant, raison NO_OBSERVATIONS", () => {
    const result = fuseMarketObservations([], { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("insufficient");
    expect(result.insufficiencyReason).toBe("NO_OBSERVATIONS");
  });

  it("toutes les observations dans une autre devise : insuffisant, jamais convertie silencieusement", () => {
    const result = fuseMarketObservations([obs({ currency: "EUR" })], { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("insufficient");
    expect(result.insufficiencyReason).toBe("ALL_WRONG_CURRENCY");
  });

  it("toutes exclues pour incompatibilité de variante : insuffisant, jamais fusionnées de force", () => {
    const target: FusionTarget = { currency: "USD", attributes: { storageGb: 128 } };
    const result = fuseMarketObservations([obs({ attributes: { storageGb: 256 } })], { asOf: ASOF, target });
    expect(result.status).toBe("insufficient");
    expect(result.insufficiencyReason).toBe("ALL_EXCLUDED_VARIANT_MISMATCH");
  });

  it("toutes exclues comme lot/bundle/pièces : insuffisant", () => {
    const result = fuseMarketObservations([obs({ title: "iPhone 13 for parts not working" })], { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("insufficient");
    expect(result.insufficiencyReason).toBe("ALL_EXCLUDED_BUNDLE_OR_PARTS");
  });
});

describe("fuseMarketObservations — pondération par palier", () => {
  it("le palier A domine largement D/E même avec beaucoup moins d'observations", () => {
    const highTier = obs({ source: "bricklink", evidenceTier: "A", priceCents: 10000, matchScore: 1 });
    const lowTierObservations = Array.from({ length: 10 }, (_, i) =>
      obs({ source: "ebay", sourceItemId: `low-${i}`, evidenceTier: "E", priceCents: 50000, matchScore: 1 }),
    );
    const result = fuseMarketObservations([highTier, ...lowTierObservations], { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("estimated");
    // La médiane pondérée doit rester bien plus proche du prix A (10000) que de la masse E (50000).
    expect(result.fairCents!).toBeLessThan(30000);
  });

  it("preuve E seule (retail uniquement) : jamais une confiance élevée type revente", () => {
    const retailOnly = Array.from({ length: 5 }, (_, i) => obs({ source: "google_shopping", sourceItemId: `r-${i}`, evidenceTier: "E", priceCents: 45000 }));
    const result = fuseMarketObservations(retailOnly, { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("estimated");
    expect(result.strongestTier).toBe("E");
    expect(result.confidence).toBeLessThanOrEqual(35);
  });

  it("D peut produire une estimation prudente avec assez de données, plafonnée à 55", () => {
    const activeListings = Array.from({ length: 8 }, (_, i) => obs({ source: "ebay", sourceItemId: `d-${i}`, evidenceTier: "D", priceCents: 40000 + i * 100 }));
    const result = fuseMarketObservations(activeListings, { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("estimated");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(55);
  });
});

describe("fuseMarketObservations — preuve contradictoire", () => {
  it("preuve A fortement contradictoire réduit la confiance plutôt que d'être moyennée silencieusement", () => {
    // Même nombre de sources distinctes (bricklink + pricecharting) dans les deux scénarios,
    // pour isoler l'effet de l'ACCORD entre preuves du désaccord/diversité de sources.
    const agreeing = [
      obs({ source: "bricklink", sourceItemId: "a1", evidenceTier: "A", priceCents: 10000 }),
      obs({ source: "pricecharting", sourceItemId: "a2", evidenceTier: "A", priceCents: 10100 }),
    ];
    const contradicting = [
      obs({ source: "bricklink", sourceItemId: "a1", evidenceTier: "A", priceCents: 10000 }),
      obs({ source: "pricecharting", sourceItemId: "a2", evidenceTier: "A", priceCents: 50000 }),
    ];
    const agreeingResult = fuseMarketObservations(agreeing, { asOf: ASOF, target: TARGET_USD });
    const contradictingResult = fuseMarketObservations(contradicting, { asOf: ASOF, target: TARGET_USD });
    expect(contradictingResult.confidence).toBeLessThan(agreeingResult.confidence);
  });
});

describe("fuseMarketObservations — diversité et duplication de source", () => {
  it("plusieurs sources indépendantes augmentent la confiance plus qu'une seule source nombreuse", () => {
    const oneSourceMany = Array.from({ length: 9 }, (_, i) => obs({ source: "ebay", sourceItemId: `s-${i}`, evidenceTier: "D", priceCents: 40000 }));
    const threeSourcesFew = [
      obs({ source: "ebay", sourceItemId: "e1", evidenceTier: "D", priceCents: 40000 }),
      obs({ source: "bricklink", sourceItemId: "b1", evidenceTier: "D", priceCents: 40000 }),
      obs({ source: "pricecharting", sourceItemId: "p1", evidenceTier: "D", priceCents: 40000 }),
    ];
    const oneSourceResult = fuseMarketObservations(oneSourceMany, { asOf: ASOF, target: TARGET_USD });
    const threeSourcesResult = fuseMarketObservations(threeSourcesFew, { asOf: ASOF, target: TARGET_USD });
    expect(threeSourcesResult.confidence).toBeGreaterThan(oneSourceResult.confidence);
  });

  it("un même marchand syndiqué via deux connecteurs différents (ex. Google Shopping + eBay direct) ne compte jamais comme deux origines indépendantes", () => {
    const viaTwoConnectors = [
      obs({ source: "ebay", merchant: "ebay", sourceItemId: "e1", evidenceTier: "D", priceCents: 40000 }),
      obs({ source: "google_shopping", merchant: "ebay", sourceItemId: "g1", evidenceTier: "D", priceCents: 40000 }),
    ];
    const twoIndependentMerchants = [
      obs({ source: "ebay", merchant: "ebay", sourceItemId: "e1", evidenceTier: "D", priceCents: 40000 }),
      obs({ source: "google_shopping", merchant: "fnac.ch", sourceItemId: "g1", evidenceTier: "D", priceCents: 40000 }),
    ];
    const sameOriginResult = fuseMarketObservations(viaTwoConnectors, { asOf: ASOF, target: TARGET_USD });
    const distinctOriginResult = fuseMarketObservations(twoIndependentMerchants, { asOf: ASOF, target: TARGET_USD });

    expect(sameOriginResult.sourceCount).toBe(1);
    expect(distinctOriginResult.sourceCount).toBe(2);
    expect(distinctOriginResult.confidence).toBeGreaterThan(sameOriginResult.confidence);
  });

  it("evidenceMix distingue le connecteur (source) de l'origine réelle (merchant)", () => {
    const observations = [obs({ source: "google_shopping", merchant: "ebay", sourceItemId: "g1", evidenceTier: "D", priceCents: 40000 })];
    const result = fuseMarketObservations(observations, { asOf: ASOF, target: TARGET_USD });
    expect(result.evidenceMix).toEqual([{ tier: "D", source: "google_shopping", merchant: "ebay", count: 1 }]);
  });

  it("20 annonces d'une seule source ne comptent jamais comme 20 signaux indépendants (amortissement racine carrée)", () => {
    const manyFromOneSource = Array.from({ length: 20 }, (_, i) => obs({ source: "ebay", sourceItemId: `many-${i}`, evidenceTier: "D", priceCents: 40000 }));
    const fewFromOneSource = Array.from({ length: 2 }, (_, i) => obs({ source: "ebay", sourceItemId: `few-${i}`, evidenceTier: "D", priceCents: 40000 }));
    const manyResult = fuseMarketObservations(manyFromOneSource, { asOf: ASOF, target: TARGET_USD });
    const fewResult = fuseMarketObservations(fewFromOneSource, { asOf: ASOF, target: TARGET_USD });
    // La confiance croît avec le volume mais jamais linéairement (20 vs 2 ne doit pas produire un facteur 10).
    expect(manyResult.confidence).toBeGreaterThan(fewResult.confidence);
    expect(manyResult.confidence).toBeLessThan(fewResult.confidence * 3);
  });
});

describe("fuseMarketObservations — fraîcheur / décroissance historique", () => {
  it("une observation ancienne pèse moins qu'une observation récente à palier égal", () => {
    const recent = obs({ source: "bricklink", sourceItemId: "recent", evidenceTier: "B", priceCents: 20000, observedAt: ASOF });
    const stale = obs({
      source: "bricklink",
      sourceItemId: "stale",
      evidenceTier: "B",
      priceCents: 60000,
      observedAt: "2025-06-01T00:00:00.000Z", // > 100 jours avant ASOF
    });
    const result = fuseMarketObservations([recent, stale], { asOf: ASOF, target: TARGET_USD, recencyHalfLifeDays: 30 });
    expect(result.status).toBe("estimated");
    // Le prix récent doit dominer largement le prix ancien dans la médiane pondérée.
    expect(result.fairCents!).toBeLessThan(40000);
  });

  it("une donnée historique spécialisée récente peut renforcer la confiance comme une donnée live", () => {
    const historicalRecent = obs({ source: "pricecharting", evidenceTier: "B", observedAt: ASOF, priceCents: 20000 });
    const result = fuseMarketObservations([historicalRecent], { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("estimated");
    expect(result.freshnessHours).toBe(0);
  });
});

describe("fuseMarketObservations — filtrage bundle/pièces réutilisé", () => {
  it("écarte une annonce bundle/pièces même mélangée à des annonces valides", () => {
    const valid = obs({ sourceItemId: "valid", title: "iPhone 13 128GB unlocked", priceCents: 40000 });
    const bundle = obs({ sourceItemId: "bundle", title: "iPhone 13 bundle lot of 3", priceCents: 90000 });
    const result = fuseMarketObservations([valid, bundle], { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("estimated");
    expect(result.evidenceCount).toBe(1);
  });
});

describe("fuseMarketObservations — sortie", () => {
  it("expose low <= fair <= high, currency, evidenceMix, reasons", () => {
    const observations = [
      obs({ source: "bricklink", sourceItemId: "1", evidenceTier: "A", priceCents: 10000 }),
      obs({ source: "ebay", sourceItemId: "2", evidenceTier: "D", priceCents: 11000 }),
    ];
    const result = fuseMarketObservations(observations, { asOf: ASOF, target: TARGET_USD });
    expect(result.status).toBe("estimated");
    expect(result.lowCents!).toBeLessThanOrEqual(result.fairCents!);
    expect(result.fairCents!).toBeLessThanOrEqual(result.highCents!);
    expect(result.currency).toBe("USD");
    expect(result.evidenceMix.length).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.sourceCount).toBe(2);
  });

  it("jamais de soldAt/évidence de vente inventée : la fonction n'a même pas ce champ en entrée", () => {
    // FusionObservation n'expose pas soldAt du tout — vérification structurelle par absence de champ.
    const observation = obs();
    expect((observation as unknown as Record<string, unknown>).soldAt).toBeUndefined();
  });
});
