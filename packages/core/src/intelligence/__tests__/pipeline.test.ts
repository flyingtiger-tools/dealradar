import { describe, expect, it } from "vitest";
import { runIntelligencePipeline } from "../pipeline";
import type { NormalizedListing, NormalizedComparable, CostInputs, IntelligencePipelineInput } from "../types";

const ASOF = "2026-07-01T00:00:00.000Z";

function listing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: "listing-1",
    sourceSlug: "test",
    title: "LEGO Star Wars 75192 Millennium Falcon",
    priceCents: 40000,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: { setNumber: "75192", piecesCount: 7541 },
    ...overrides,
  };
}

function soldComparable(id: string, priceCents: number, overrides: Partial<NormalizedComparable> = {}): NormalizedComparable {
  return {
    id,
    sourceSlug: "test",
    title: "LEGO Star Wars 75192 vendu",
    priceCents,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: { setNumber: "75192" },
    soldAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function costs(overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    purchasePriceCents: 40000,
    shippingCostCents: 1500,
    platformFeeRate: 0.12,
    refurbCostCents: 0,
    riskReserveRate: 0.05,
    ...overrides,
  };
}

function run(input: Partial<IntelligencePipelineInput>) {
  return runIntelligencePipeline({
    listing: listing(),
    candidates: [],
    costs: costs(),
    asOf: ASOF,
    ...input,
  });
}

describe("runIntelligencePipeline — scénarios", () => {
  it("données insuffisantes : moins de 3 comparables vendus → INSUFFICIENT_DATA, jamais BUY", () => {
    const result = run({
      candidates: [soldComparable("c1", 90000), soldComparable("c2", 91000)],
      costs: costs({ purchasePriceCents: 20000 }),
    });
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("faux comparables : un produit différent (même catégorie, set différent) est exclu du pool", () => {
    const candidates = [
      soldComparable("c1", 55000),
      soldComparable("c2", 56000),
      soldComparable("c3", 54000),
      soldComparable("c4", 57000),
      soldComparable("c5", 58000),
      soldComparable("fake1", 9000, { attributes: { setNumber: "OTHER-SET" } }),
      soldComparable("fake2", 999999, { attributes: { setNumber: "OTHER-SET" } }),
    ];
    const result = run({ candidates });
    expect(result.comparables.matched.map((c) => c.id).sort()).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("catégories différentes : un comparable d'une autre catégorie n'entre jamais dans le pool, même avec des attributs identiques", () => {
    const candidates = [
      soldComparable("c1", 55000),
      soldComparable("c2", 56000),
      soldComparable("c3", 54000),
      soldComparable("c4", 57000),
      soldComparable("c5", 58000),
      soldComparable("wrong-category", 55000, { categorySlug: "gaming" }),
    ];
    const result = run({ candidates });
    expect(result.comparables.matched.some((c) => c.id === "wrong-category")).toBe(false);
  });

  it("valeurs aberrantes : un prix isolé est retiré et n'affecte pas l'estimation", () => {
    const candidates = [
      soldComparable("c1", 55000),
      soldComparable("c2", 56000),
      soldComparable("c3", 54000),
      soldComparable("c4", 57000),
      soldComparable("c5", 900000),
    ];
    const result = run({ candidates });
    expect(result.comparables.excludedOutliers.map((c) => c.id)).toEqual(["c5"]);
    expect(result.estimate?.sampleSize).toBe(4);
  });

  it("forte marge mais risque élevé : ne recommande jamais BUY malgré un excellent score brut", () => {
    const appleListing = listing({
      title: "iPhone 13 128Go — icloud verrouillé, compte lié non levé",
      categorySlug: "apple",
      priceCents: 20000,
      attributes: { model: "iPhone 13", storageGb: 128 },
    });
    const candidates = Array.from({ length: 6 }, (_, i) =>
      soldComparable(`c${i}`, 60000 + i * 500, {
        categorySlug: "apple",
        attributes: { model: "iPhone 13", storageGb: 128 },
      }),
    );
    const result = run({
      listing: appleListing,
      candidates,
      costs: costs({ purchasePriceCents: 20000 }),
    });
    expect(result.scores.deal).toBeGreaterThanOrEqual(70);
    expect(result.identity.matchedRiskSignals.map((s) => s.id)).toContain("icloud_lock_risk");
    // Rule 6 : le risque catégorie fait chuter la confiance sous le plancher —
    // la marge brute, aussi élevée soit-elle, ne peut jamais forcer un BUY.
    expect(result.decision).not.toBe("BUY");
  });

  it("confiance faible : identification incomplète bloque la décision même avec un prix qui semble intéressant", () => {
    const poorListing = listing({ attributes: { setNumber: "75192" } }); // piecesCount manquant
    const candidates = [
      soldComparable("c1", 90000, { attributes: { setNumber: "75192", hasBox: false } }),
      soldComparable("c2", 91000, { attributes: { setNumber: "75192", hasBox: false } }),
      soldComparable("c3", 92000, { attributes: { setNumber: "75192", hasBox: false } }),
    ];
    const result = run({
      listing: {
        ...poorListing,
        attributes: { ...poorListing.attributes, hasBox: false, complete: false },
      },
      candidates,
      costs: costs({ purchasePriceCents: 20000 }),
    });
    // Comparables suffisants et deal score calculable, mais confiance sous le plancher.
    expect(result.comparables.used.length).toBeGreaterThanOrEqual(3);
    expect(result.scores.deal).not.toBeNull();
    expect(result.scores.confidence).toBeLessThan(40);
    expect(result.decision).toBe("INSUFFICIENT_DATA");
  });

  it("faible marge : recommande PASS", () => {
    const candidates = Array.from({ length: 6 }, (_, i) => soldComparable(`c${i}`, 50000 + i * 200));
    const result = run({
      listing: listing({ priceCents: 55000 }),
      candidates,
      costs: costs({ purchasePriceCents: 55000 }),
    });
    expect(result.decision).toBe("PASS");
  });

  it("bonne opportunité : marge élevée, échantillon solide, confiance forte → BUY", () => {
    const candidates = Array.from({ length: 6 }, (_, i) => soldComparable(`c${i}`, 90000 + i * 500));
    const result = run({
      listing: listing({ priceCents: 40000 }),
      candidates,
      costs: costs({ purchasePriceCents: 40000 }),
    });
    expect(result.decision).toBe("BUY");
    expect(result.whyPanel.factors.length).toBeGreaterThan(0);
    expect(result.whyPanel.decision).toBe("BUY");
  });

  it("profit après frais : le profit net du pipeline reflète bien livraison, frais de plateforme et réserve de risque", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => soldComparable(`c${i}`, 90000 + i * 100));
    const result = run({
      candidates,
      costs: costs({ purchasePriceCents: 40000, shippingCostCents: 2000, refurbCostCents: 3000 }),
    });
    expect(result.netProfit).not.toBeNull();
    const np = result.netProfit!;
    expect(np.totalCostCents).toBe(40000 + 2000 + 3000 + np.platformFeeCents + np.riskReserveCents);
    expect(np.netProfitCents).toBe(np.resaleBasisCents - np.totalCostCents);
  });

  it("est déterministe : mêmes entrées → même résultat", () => {
    const candidates = Array.from({ length: 6 }, (_, i) => soldComparable(`c${i}`, 90000 + i * 500));
    const input: IntelligencePipelineInput = { listing: listing(), candidates, costs: costs(), asOf: ASOF };
    expect(runIntelligencePipeline(input)).toEqual(runIntelligencePipeline({ ...input, candidates: [...candidates] }));
  });
});
