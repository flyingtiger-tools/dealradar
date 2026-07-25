import { describe, expect, it } from "vitest";
import { dealScoreV1 } from "../deal-score";
import type { ScoringInput } from "../types";

function input(priceCents: number, comparablePrices: number[]): ScoringInput {
  return {
    listing: {
      id: "l1",
      priceCents,
      condition: "good",
      firstSeenAt: new Date().toISOString(),
    },
    comparables: {
      id: "c1",
      listingId: "l1",
      method: "hnsw_v1",
      computedAt: new Date().toISOString(),
      members: comparablePrices.map((p, i) => ({
        listingId: `m${i}`,
        similarity: 0.9,
        priceCents: p,
      })),
    },
  };
}

describe("dealScoreV1", () => {
  it("signale Acheter quand le prix est nettement sous le marché", () => {
    const r = dealScoreV1.compute(input(5_000, [10_000, 11_000, 12_000, 13_000, 14_000]));
    expect(r.verdict).toBe("buy");
    expect(r.value).toBeGreaterThanOrEqual(70);
  });

  it("signale Attendre quand le prix est dans le marché", () => {
    const r = dealScoreV1.compute(input(12_000, [10_000, 11_000, 12_000, 13_000, 14_000]));
    expect(r.verdict).toBe("wait");
  });

  it("reste neutre avec trop peu de comparables", () => {
    const r = dealScoreV1.compute(input(5_000, [10_000]));
    expect(r.verdict).toBe("wait");
    expect(r.value).toBe(50);
    expect(r.explanation.reason).toBe("insufficient_comparables");
  });

  it("est déterministe", () => {
    const a = dealScoreV1.compute(input(8_000, [7_000, 9_000, 10_000, 12_000]));
    const b = dealScoreV1.compute(input(8_000, [7_000, 9_000, 10_000, 12_000]));
    expect(a).toEqual(b);
  });
});
