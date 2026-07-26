import { describe, expect, it } from "vitest";
import { estimatePrice } from "../estimate";
import type { NormalizedComparable } from "../types";

function comparable(priceCents: number): NormalizedComparable {
  return {
    id: `c-${priceCents}`,
    sourceSlug: "test",
    title: "Comparable",
    priceCents,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: {},
    soldAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("estimatePrice", () => {
  it("retourne null sans comparable", () => {
    expect(estimatePrice([])).toBeNull();
  });

  it("calcule médiane/p25/p75 et utilise p25 comme figure prudente", () => {
    const comps = [100, 200, 300, 400, 500].map(comparable);
    const estimate = estimatePrice(comps);
    expect(estimate).toEqual({
      sampleSize: 5,
      medianCents: 300,
      p25Cents: 200,
      p75Cents: 400,
      conservativeCents: 200,
    });
  });

  it("est déterministe : mêmes entrées → même sortie", () => {
    const comps = [150, 250, 350].map(comparable);
    expect(estimatePrice(comps)).toEqual(estimatePrice([...comps]));
  });
});
