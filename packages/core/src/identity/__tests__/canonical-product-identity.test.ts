import { describe, expect, it } from "vitest";
import { createCanonicalProductIdentity, deriveProductKey, isHardConflictField } from "../canonical-product-identity";

describe("deriveProductKey", () => {
  it("déterministe : la même combinaison produit toujours la même clé", () => {
    const seed = { brand: "Apple", model: "iPhone 13", storage: "128GB" };
    expect(deriveProductKey("apple", seed)).toBe(deriveProductKey("apple", seed));
  });

  it("insensible à la casse/aux espaces superflus", () => {
    const a = deriveProductKey("apple", { brand: "Apple", model: "iPhone 13" });
    const b = deriveProductKey("apple", { brand: "  apple  ", model: "IPHONE 13" });
    expect(a).toBe(b);
  });

  it("deux produits différents (variante différente) produisent des clés différentes", () => {
    const a = deriveProductKey("apple", { brand: "Apple", model: "iPhone 13", storage: "128GB" });
    const b = deriveProductKey("apple", { brand: "Apple", model: "iPhone 13", storage: "256GB" });
    expect(a).not.toBe(b);
  });

  it("aucun champ connu -> repli sur la catégorie seule, jamais une clé vide", () => {
    expect(deriveProductKey("lego", {})).toBe("lego");
  });

  it("jamais une valeur aléatoire/horodatée dans la clé", () => {
    const key1 = deriveProductKey("lego", { brand: "LEGO", model: "10300" });
    const key2 = deriveProductKey("lego", { brand: "LEGO", model: "10300" });
    expect(key1).toBe(key2);
    expect(key1).not.toMatch(/\d{10,}/); // pas de timestamp/id aléatoire injecté
  });
});

describe("createCanonicalProductIdentity", () => {
  it("crée une identité vide avec une clé dérivée de la seule catégorie si aucune n'est fournie", () => {
    const identity = createCanonicalProductIdentity("apple");
    expect(identity.productKey).toBe("apple");
    expect(identity.categorySlug).toBe("apple");
    expect(identity.fields).toEqual({});
    expect(identity.aliases).toEqual([]);
    expect(identity.conflicts).toEqual([]);
  });

  it("accepte une clé déjà connue (ex. product_key déjà résolu sur une MarketObservation persistée)", () => {
    const identity = createCanonicalProductIdentity("apple", "apple:iphone-13:128gb");
    expect(identity.productKey).toBe("apple:iphone-13:128gb");
  });
});

describe("isHardConflictField", () => {
  it("les identifiants structurels et attributs structurants sont des champs durs", () => {
    expect(isHardConflictField("upc")).toBe(true);
    expect(isHardConflictField("mpn")).toBe(true);
    expect(isHardConflictField("bricklinkNo")).toBe(true);
    expect(isHardConflictField("storage")).toBe(true);
    expect(isHardConflictField("size")).toBe(true);
    expect(isHardConflictField("platform")).toBe(true);
    expect(isHardConflictField("edition")).toBe(true);
  });

  it("les champs descriptifs restent doux", () => {
    expect(isHardConflictField("brand")).toBe(false);
    expect(isHardConflictField("color")).toBe(false);
    expect(isHardConflictField("model")).toBe(false);
  });
});
