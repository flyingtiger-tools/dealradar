import { describe, expect, it } from "vitest";
import { mergeExtractions } from "../merge";
import type { SourcedExtraction } from "../../types";

function candidate(source: SourcedExtraction["source"], overrides: Partial<SourcedExtraction["product"]> = {}): SourcedExtraction {
  return {
    source,
    product: {
      brand: null,
      model: null,
      reference: null,
      category: null,
      subcategory: null,
      condition: null,
      language: null,
      color: null,
      capacity: null,
      accessories: null,
      serialNumberDetected: { value: false, confidence: 0.5, source },
      attributes: {},
      ...overrides,
    },
  };
}

describe("mergeExtractions", () => {
  it("retourne null pour un champ absent de toutes les sources", () => {
    const { product } = mergeExtractions([candidate("deterministic")]);
    expect(product.brand).toBeNull();
  });

  it("garde la seule valeur présente quand une seule source la fournit", () => {
    const { product } = mergeExtractions([
      candidate("deterministic", { brand: { value: "LEGO", confidence: 0.9, source: "deterministic" } }),
    ]);
    expect(product.brand?.value).toBe("LEGO");
  });

  it("augmente la confiance à la valeur max quand deux sources s'accordent", () => {
    const { product, warnings } = mergeExtractions([
      candidate("deterministic", { brand: { value: "Canon", confidence: 0.7, source: "deterministic" } }),
      candidate("ai", { brand: { value: "Canon", confidence: 0.95, source: "ai" } }),
    ]);
    expect(product.brand?.value).toBe("Canon");
    expect(product.brand?.confidence).toBe(0.95);
    expect(warnings).toHaveLength(0);
  });

  it("désaccord mineur (champ non critique) : garde la valeur la plus confiante avec une pénalité, sans warning", () => {
    const { product, warnings } = mergeExtractions([
      candidate("deterministic", { color: { value: "rouge", confidence: 0.6, source: "deterministic" } }),
      candidate("ai", { color: { value: "bleu", confidence: 0.9, source: "ai" } }),
    ]);
    expect(product.color?.value).toBe("bleu");
    expect(product.color?.confidence).toBeCloseTo(0.6, 5);
    expect(warnings).toHaveLength(0);
  });

  it("une valeur eBay (provided) faiblement confiante ne peut jamais écraser une valeur IA fortement confirmée", () => {
    const ebay = candidate("provided");
    ebay.product.attributes.model = { value: "iPhone 11", confidence: 0.4, source: "provided" };
    const ai = candidate("ai");
    ai.product.attributes.model = { value: "iPhone 13 Pro", confidence: 0.95, source: "ai" };

    const { product } = mergeExtractions([ebay, ai]);
    expect(product.attributes.model?.value).toBe("iPhone 13 Pro");
  });

  it("désaccord majeur sur une clé critique produit un MAJOR_CONTRADICTION et force une confiance basse", () => {
    const a = candidate("deterministic");
    a.product.attributes.setNumber = { value: "75313", confidence: 0.9, source: "deterministic" };
    const b = candidate("ai");
    b.product.attributes.setNumber = { value: "10294", confidence: 0.85, source: "ai" };

    const { product, warnings } = mergeExtractions([a, b], ["setNumber"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("MAJOR_CONTRADICTION");
    expect(warnings[0]?.field).toBe("setNumber");
    expect(product.attributes.setNumber?.confidence).toBeLessThanOrEqual(0.2);
  });

  it("serialNumberDetected : vrai si au moins une source détecte, jamais un champ manquant", () => {
    const a = candidate("deterministic");
    a.product.serialNumberDetected = { value: false, confidence: 0.8, source: "deterministic" };
    const b = candidate("ai");
    b.product.serialNumberDetected = { value: true, confidence: 0.7, source: "ai" };

    const { product } = mergeExtractions([a, b]);
    expect(product.serialNumberDetected.value).toBe(true);
  });

  it("fusionne les clés d'attributes disjointes sans collision", () => {
    const a = candidate("deterministic");
    a.product.attributes.setNumber = { value: "75313", confidence: 0.9, source: "deterministic" };
    const b = candidate("ai");
    b.product.attributes.pieceCount = { value: 1300, confidence: 0.7, source: "ai" };

    const { product } = mergeExtractions([a, b]);
    expect(product.attributes.setNumber?.value).toBe("75313");
    expect(product.attributes.pieceCount?.value).toBe(1300);
  });
});
