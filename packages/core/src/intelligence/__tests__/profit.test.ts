import { describe, expect, it } from "vitest";
import { computeNetProfit } from "../profit";
import type { PriceEstimate, CostInputs } from "../types";

function estimate(overrides: Partial<PriceEstimate> = {}): PriceEstimate {
  return { sampleSize: 5, medianCents: 30000, p25Cents: 25000, p75Cents: 35000, conservativeCents: 25000, ...overrides };
}

function costs(overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    purchasePriceCents: 15000,
    shippingCostCents: 1000,
    platformFeeRate: 0.12,
    refurbCostCents: 0,
    riskReserveRate: 0.05,
    ...overrides,
  };
}

describe("computeNetProfit", () => {
  it("soustrait achat, livraison, frais de plateforme et réserve de risque de la revente prudente", () => {
    const result = computeNetProfit(estimate(), costs());
    // resale 25000 ; fee 12% = 3000 ; reserve 5% = 1250
    expect(result.platformFeeCents).toBe(3000);
    expect(result.riskReserveCents).toBe(1250);
    expect(result.totalCostCents).toBe(15000 + 1000 + 0 + 3000 + 1250);
    expect(result.netProfitCents).toBe(25000 - (15000 + 1000 + 0 + 3000 + 1250));
  });

  it("inclut le coût de remise en état quand il est fourni", () => {
    const withRefurb = computeNetProfit(estimate(), costs({ refurbCostCents: 4000 }));
    const withoutRefurb = computeNetProfit(estimate(), costs());
    expect(withRefurb.netProfitCents).toBe(withoutRefurb.netProfitCents - 4000);
  });

  it("calcule un ratio de marge négatif quand les coûts dépassent la revente", () => {
    const result = computeNetProfit(estimate({ conservativeCents: 10000 }), costs());
    expect(result.netProfitCents).toBeLessThan(0);
    expect(result.marginRatio).toBeLessThan(0);
  });
});
