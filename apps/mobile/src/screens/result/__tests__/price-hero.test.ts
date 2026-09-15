import { deriveHeroPriceRange } from "../price-hero";
import type { ResultViewModel } from "../result-view-model";

function priceRow(overrides: Partial<ResultViewModel["prices"][number]>): ResultViewModel["prices"][number] {
  return {
    source: "tcgdex",
    amountCents: 1000,
    currency: "CHF",
    condition: null,
    updatedAt: null,
    convertedAmountCents: null,
    convertedCurrency: null,
    ...overrides,
  };
}

describe("deriveHeroPriceRange", () => {
  it("retourne null quand aucun prix n'est exploitable", () => {
    expect(deriveHeroPriceRange({ prices: [] })).toBeNull();
  });

  it("ignore un prix ni en CHF ni converti", () => {
    expect(deriveHeroPriceRange({ prices: [priceRow({ currency: "EUR" })] })).toBeNull();
  });

  it("utilise le montant natif quand la devise est déjà CHF", () => {
    expect(deriveHeroPriceRange({ prices: [priceRow({ amountCents: 963, currency: "CHF" })] })).toEqual({ low: 9.63, high: 9.63, currency: "CHF" });
  });

  it("utilise le montant converti quand la devise source n'est pas CHF", () => {
    expect(
      deriveHeroPriceRange({ prices: [priceRow({ amountCents: 1000, currency: "EUR", convertedAmountCents: 1080, convertedCurrency: "CHF" })] }),
    ).toEqual({ low: 10.8, high: 10.8, currency: "CHF" });
  });

  it("prend le min/max sur plusieurs sources, jamais une moyenne", () => {
    const result = deriveHeroPriceRange({
      prices: [priceRow({ amountCents: 900, currency: "CHF" }), priceRow({ amountCents: 1200, currency: "CHF" }), priceRow({ amountCents: 1000, currency: "CHF" })],
    });
    expect(result).toEqual({ low: 9, high: 12, currency: "CHF" });
  });
});
