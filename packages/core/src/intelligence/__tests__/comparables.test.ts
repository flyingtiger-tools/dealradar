import { describe, expect, it } from "vitest";
import { matchComparables, selectSoldComparables, removeOutliers } from "../comparables";
import { identifyListing } from "../identify";
import type { NormalizedListing, NormalizedComparable } from "../types";

function listing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: "l1",
    sourceSlug: "test",
    title: "LEGO Star Wars 75192",
    priceCents: 60000,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: { setNumber: "75192" },
    ...overrides,
  };
}

function comparable(overrides: Partial<NormalizedComparable> = {}): NormalizedComparable {
  return {
    id: "c1",
    sourceSlug: "test",
    title: "LEGO Star Wars 75192 vendu",
    priceCents: 55000,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: { setNumber: "75192" },
    soldAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("matchComparables", () => {
  const l = listing();
  const identity = identifyListing(l);

  it("garde un comparable identique en catégorie/devise/condition/similarité", () => {
    expect(matchComparables(l, identity, [comparable()])).toHaveLength(1);
  });

  it("exclut une catégorie différente (produit non comparable)", () => {
    const result = matchComparables(l, identity, [comparable({ categorySlug: "gaming" })]);
    expect(result).toEqual([]);
  });

  it("exclut une devise différente (pas de conversion en V1)", () => {
    const result = matchComparables(l, identity, [comparable({ currency: "EUR" })]);
    expect(result).toEqual([]);
  });

  it("exclut une condition différente", () => {
    const result = matchComparables(l, identity, [comparable({ condition: "fair" })]);
    expect(result).toEqual([]);
  });

  it("exclut un set LEGO différent (similarité du profil)", () => {
    const result = matchComparables(l, identity, [comparable({ attributes: { setNumber: "10221" } })]);
    expect(result).toEqual([]);
  });

  it("sans profil résolu, ne filtre que sur les critères structurels", () => {
    const unknownListing = listing({ categorySlug: "meubles_jardin", attributes: {} });
    const unknownIdentity = identifyListing(unknownListing);
    const result = matchComparables(unknownListing, unknownIdentity, [
      comparable({ categorySlug: "meubles_jardin", attributes: { anything: "x" } }),
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("selectSoldComparables", () => {
  it("ne garde que les comparables avec une vente confirmée", () => {
    const result = selectSoldComparables([comparable(), comparable({ id: "c2", soldAt: null })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("c1");
  });
});

describe("removeOutliers", () => {
  it("retire un prix aberrant isolé parmi les comparables vendus", () => {
    const comps = [
      comparable({ id: "a", priceCents: 55000 }),
      comparable({ id: "b", priceCents: 56000 }),
      comparable({ id: "c", priceCents: 54000 }),
      comparable({ id: "d", priceCents: 57000 }),
      comparable({ id: "e", priceCents: 500000 }),
    ];
    const { used, excluded } = removeOutliers(comps);
    expect(used.map((c) => c.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(excluded.map((c) => c.id)).toEqual(["e"]);
  });
});
