import { describe, expect, it } from "vitest";
import { REFERENCE_LISTINGS } from "../../__fixtures__/reference-listings";
import { runDeterministicExtractor } from "../deterministic-extractor";
import { isSufficientForIdentification } from "../requirement-profiles";

describe("précision d'identification sur le jeu de référence", () => {
  it("l'extraction déterministe seule atteint au moins 70% de précision sur le jeu annoté", () => {
    let correct = 0;
    for (const listing of REFERENCE_LISTINGS) {
      const { product } = runDeterministicExtractor(listing);
      const sufficient = isSufficientForIdentification(product.attributes, listing.categorySlug);
      if (sufficient === listing.expectSufficientDeterministic) correct += 1;
    }
    const precision = correct / REFERENCE_LISTINGS.length;
    expect(precision).toBeGreaterThanOrEqual(0.7);
  });

  it("couvre au moins 10 exemples par catégorie supportée", () => {
    const categories = ["lego", "pokemon_tcg", "apple", "gaming", "photo"];
    for (const categorySlug of categories) {
      const count = REFERENCE_LISTINGS.filter((l) => l.categorySlug === categorySlug).length;
      expect(count).toBeGreaterThanOrEqual(10);
    }
  });
});
