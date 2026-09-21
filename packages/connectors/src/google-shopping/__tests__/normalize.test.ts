import { describe, expect, it } from "vitest";
import { normalizeSerpApiShoppingResult, normalizeSerpApiGoogleShoppingResponse, currencyForCountry } from "../normalize";
import type { SerpApiShoppingResult, SerpApiGoogleShoppingResponse } from "../raw-types";

const CONTEXT = { categorySlug: "gaming", query: "nintendo switch oled", country: "ch", collectedAt: "2026-09-21T00:00:00.000Z" };

function rawResult(overrides: Partial<SerpApiShoppingResult> = {}): SerpApiShoppingResult {
  return {
    position: 1,
    title: "Nintendo Switch OLED White",
    product_id: "gp-123",
    product_link: "https://www.google.com/shopping/product/123",
    link: "https://example-shop.ch/switch-oled",
    source: "Example Shop",
    price: "CHF 349.00",
    extracted_price: 349,
    ...overrides,
  };
}

describe("currencyForCountry", () => {
  it("mappe les marchés connus à leur devise", () => {
    expect(currencyForCountry("ch")).toBe("CHF");
    expect(currencyForCountry("US")).toBe("USD");
  });

  it("pays inconnu ou absent : null, jamais une devise devinée", () => {
    expect(currencyForCountry("xx")).toBeNull();
    expect(currencyForCountry(undefined)).toBeNull();
  });
});

describe("normalizeSerpApiShoppingResult", () => {
  it("normalise un résultat complet en MarketObservation retailPrices (palier E)", () => {
    const obs = normalizeSerpApiShoppingResult(rawResult(), CONTEXT);
    expect(obs).not.toBeNull();
    expect(obs?.source).toBe("google_shopping");
    expect(obs?.sourceItemId).toBe("gp-123");
    expect(obs?.priceAmountCents).toBe(34900);
    expect(obs?.currency).toBe("CHF");
    expect(obs?.evidenceType).toBe("retailPrices");
    expect(obs?.evidenceTier).toBe("E");
    expect(obs?.soldAt).toBeNull();
  });

  it("second_hand_condition présent : activeListings (palier D), jamais retailPrices", () => {
    const obs = normalizeSerpApiShoppingResult(rawResult({ second_hand_condition: "Used - Good" }), CONTEXT);
    expect(obs?.evidenceType).toBe("activeListings");
    expect(obs?.evidenceTier).toBe("D");
    expect(obs?.condition).toBe("Used - Good");
  });

  it("jamais soldTransactions, quel que soit le résultat — Google Shopping ne confirme aucune vente", () => {
    const obs1 = normalizeSerpApiShoppingResult(rawResult(), CONTEXT);
    const obs2 = normalizeSerpApiShoppingResult(rawResult({ second_hand_condition: "Used" }), CONTEXT);
    expect(obs1?.evidenceType).not.toBe("soldTransactions");
    expect(obs2?.evidenceType).not.toBe("soldTransactions");
  });

  it("prix manquant : null, jamais une valeur inventée", () => {
    expect(normalizeSerpApiShoppingResult(rawResult({ extracted_price: undefined }), CONTEXT)).toBeNull();
  });

  it("titre manquant : null", () => {
    expect(normalizeSerpApiShoppingResult(rawResult({ title: undefined }), CONTEXT)).toBeNull();
  });

  it("aucun identifiant exploitable (ni product_id, ni product_link, ni link) : null", () => {
    expect(normalizeSerpApiShoppingResult(rawResult({ product_id: undefined, product_link: undefined, link: undefined }), CONTEXT)).toBeNull();
  });

  it("pays non mappé à une devise connue : null, jamais un prix sans devise fiable", () => {
    expect(normalizeSerpApiShoppingResult(rawResult(), { ...CONTEXT, country: "zz" })).toBeNull();
  });

  it("conserve la requête et l'horodatage de collecte tels quels, jamais reconstruits", () => {
    const obs = normalizeSerpApiShoppingResult(rawResult(), CONTEXT);
    expect(obs?.query).toBe("nintendo switch oled");
    expect(obs?.observedAt).toBe("2026-09-21T00:00:00.000Z");
  });
});

describe("normalizeSerpApiGoogleShoppingResponse", () => {
  it("normalise plusieurs résultats, ignore silencieusement ceux inexploitables", () => {
    const response: SerpApiGoogleShoppingResponse = {
      shopping_results: [rawResult(), rawResult({ product_id: "gp-456", extracted_price: undefined })],
    };
    const observations = normalizeSerpApiGoogleShoppingResponse(response, CONTEXT);
    expect(observations).toHaveLength(1);
  });

  it("shopping_results absent : tableau vide, jamais une exception", () => {
    expect(normalizeSerpApiGoogleShoppingResponse({}, CONTEXT)).toEqual([]);
  });
});
