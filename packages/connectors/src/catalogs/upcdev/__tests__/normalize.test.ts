import { describe, expect, it } from "vitest";
import { matchUpcDevProduct, normalizeUpcDevProduct } from "../normalize";
import { COCA_COLA_RESPONSE } from "./fixtures";

describe("normalizeUpcDevProduct", () => {
  it("mappe upc/name/brand/category, jamais de priceHints", () => {
    const item = normalizeUpcDevProduct(COCA_COLA_RESPONSE.data);
    expect(item.source).toBe("upcdev");
    expect(item.externalId).toBe("0049000042566");
    expect(item.name).toBe("Coca-Cola Zero Sugar");
    expect(item.canonicalAttributes.brand).toBe("Coca-Cola");
    expect(item.priceHints).toBeUndefined();
  });

  it("brand/category vides (chaîne vide réellement observée en direct) : null, jamais une chaîne vide propagée", () => {
    const item = normalizeUpcDevProduct({ upc: "0000000000123", name: "Oranges", brand: "", category: "" });
    expect(item.canonicalAttributes.brand).toBeNull();
    expect(item.canonicalAttributes.category).toBeNull();
  });

  it("name absent : repli sur l'UPC lui-même, jamais une chaîne vide", () => {
    const item = normalizeUpcDevProduct({ upc: "123" });
    expect(item.name).toBe("123");
  });
});

describe("matchUpcDevProduct", () => {
  it("confiance 1, matchedOn upc", () => {
    const match = matchUpcDevProduct(COCA_COLA_RESPONSE.data);
    expect(match.confidence).toBe(1);
    expect(match.matchedOn).toEqual(["upc"]);
  });
});
