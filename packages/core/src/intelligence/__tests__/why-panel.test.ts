import { describe, expect, it } from "vitest";
import { buildWhyPanel } from "../why-panel";
import { CATEGORY_PROFILES } from "../category-profiles";
import type { StructuredIdentity, NormalizedComparable, NetProfitResult } from "../types";

function identity(overrides: Partial<StructuredIdentity> = {}): StructuredIdentity {
  return {
    categorySlug: "lego",
    profile: CATEGORY_PROFILES.lego,
    missingRequiredFields: [],
    matchedRiskSignals: [],
    ...overrides,
  };
}

function soldComparable(): NormalizedComparable {
  return {
    id: "c1",
    sourceSlug: "test",
    title: "Comparable",
    priceCents: 10000,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: {},
    soldAt: "2026-06-01T00:00:00.000Z",
  };
}

const netProfit: NetProfitResult = {
  resaleBasisCents: 10000,
  platformFeeCents: 1200,
  riskReserveCents: 500,
  totalCostCents: 8000,
  netProfitCents: 2000,
  marginRatio: 0.2,
};

describe("buildWhyPanel", () => {
  it("inclut un facteur par comparable, profit net et liquidité", () => {
    const panel = buildWhyPanel({
      identity: identity(),
      usedComparables: [soldComparable(), soldComparable()],
      excludedOutliers: [],
      estimate: { sampleSize: 2, medianCents: 10000, p25Cents: 9500, p75Cents: 10500, conservativeCents: 9500 },
      netProfit,
      scores: { deal: 70, confidence: 65, liquidity: 55 },
      decision: "BUY",
      reason: "Bonne opportunité.",
    });

    expect(panel.decision).toBe("BUY");
    expect(panel.factors.map((f) => f.id)).toEqual(
      expect.arrayContaining(["sold_comparables", "net_profit", "estimate_spread", "liquidity"]),
    );
  });

  it("signale les champs manquants et les signaux de risque comme facteurs négatifs", () => {
    const riskSignal = CATEGORY_PROFILES.lego.riskSignals[0]!;
    const panel = buildWhyPanel({
      identity: identity({ missingRequiredFields: ["setNumber"], matchedRiskSignals: [riskSignal] }),
      usedComparables: [],
      excludedOutliers: [],
      estimate: null,
      netProfit: null,
      scores: { deal: null, confidence: 20, liquidity: 0 },
      decision: "INSUFFICIENT_DATA",
      reason: "Données insuffisantes.",
    });

    const missingFieldsFactor = panel.factors.find((f) => f.id === "missing_fields");
    const riskFactor = panel.factors.find((f) => f.id === `risk_${riskSignal.id}`);
    expect(missingFieldsFactor?.direction).toBe("negative");
    expect(riskFactor?.direction).toBe("negative");
  });

  it("signale une catégorie sans profil connu", () => {
    const panel = buildWhyPanel({
      identity: identity({ profile: null, categorySlug: "meubles_jardin" }),
      usedComparables: [],
      excludedOutliers: [],
      estimate: null,
      netProfit: null,
      scores: { deal: null, confidence: 10, liquidity: 0 },
      decision: "INSUFFICIENT_DATA",
      reason: "Catégorie non couverte.",
    });
    expect(panel.factors.find((f) => f.id === "unknown_category")).toBeDefined();
  });
});
