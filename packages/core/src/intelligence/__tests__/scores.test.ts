import { describe, expect, it } from "vitest";
import { computeDealScore, computeConfidenceScore, computeLiquidityScore } from "../scores";
import type { NetProfitResult, StructuredIdentity, NormalizedComparable } from "../types";
import { CATEGORY_PROFILES } from "../category-profiles";

function netProfit(marginRatio: number): NetProfitResult {
  return {
    resaleBasisCents: 10000,
    platformFeeCents: 1000,
    riskReserveCents: 500,
    totalCostCents: 8000,
    netProfitCents: Math.round(marginRatio * 8000),
    marginRatio,
  };
}

function identity(overrides: Partial<StructuredIdentity> = {}): StructuredIdentity {
  return {
    categorySlug: "lego",
    profile: CATEGORY_PROFILES.lego,
    missingRequiredFields: [],
    matchedRiskSignals: [],
    ...overrides,
  };
}

function soldComparable(soldAt: string): NormalizedComparable {
  return {
    id: `c-${soldAt}`,
    sourceSlug: "test",
    title: "Comparable",
    priceCents: 10000,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: {},
    soldAt,
  };
}

describe("computeDealScore", () => {
  it("retourne 0 sans profit net", () => {
    expect(computeDealScore(null)).toBe(0);
  });

  it("centre le score sur 50 pour une marge nulle et monte avec la marge", () => {
    expect(computeDealScore(netProfit(0))).toBe(50);
    expect(computeDealScore(netProfit(0.5))).toBeGreaterThan(50);
    expect(computeDealScore(netProfit(-0.5))).toBeLessThan(50);
  });
});

describe("computeConfidenceScore", () => {
  it("augmente avec le nombre de comparables vendus", () => {
    const low = computeConfidenceScore(identity(), 1, null);
    const high = computeConfidenceScore(identity(), 8, null);
    expect(high).toBeGreaterThan(low);
  });

  it("pénalise les champs manquants et les signaux de risque", () => {
    const clean = computeConfidenceScore(identity(), 5, null);
    const withIssues = computeConfidenceScore(
      identity({
        missingRequiredFields: ["setNumber"],
        matchedRiskSignals: [CATEGORY_PROFILES.lego.riskSignals[0]!],
      }),
      5,
      null,
    );
    expect(withIssues).toBeLessThan(clean);
  });

  it("pénalise une catégorie sans profil connu", () => {
    const withProfile = computeConfidenceScore(identity(), 5, null);
    const withoutProfile = computeConfidenceScore(identity({ profile: null }), 5, null);
    expect(withoutProfile).toBeLessThan(withProfile);
  });
});

describe("computeLiquidityScore", () => {
  const asOf = "2026-07-01T00:00:00.000Z";

  it("retourne 0 sans comparable vendu", () => {
    expect(computeLiquidityScore([], asOf)).toBe(0);
  });

  it("score plus haut pour des ventes récentes et nombreuses", () => {
    const recent = Array.from({ length: 8 }, () => soldComparable("2026-06-20T00:00:00.000Z"));
    const sparse = [soldComparable("2024-01-01T00:00:00.000Z")];
    expect(computeLiquidityScore(recent, asOf)).toBeGreaterThan(computeLiquidityScore(sparse, asOf));
  });
});
