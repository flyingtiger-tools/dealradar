import { describe, expect, it } from "vitest";
import { isOpenFactsMatch, matchOpenFactsProduct, normalizeOpenFactsProduct } from "../normalize";
import { NUTELLA_FOUND, OPF_TOILET_GEL_FOUND, INVALID_CODE, NOT_FOUND, FOUND_IN_SISTER_PROJECT } from "./fixtures/responses";

describe("isOpenFactsMatch", () => {
  it("status === 1 avec un produit : correspondance", () => {
    expect(isOpenFactsMatch(NUTELLA_FOUND)).toBe(true);
  });

  it("status === 0 (introuvable) : jamais une correspondance", () => {
    expect(isOpenFactsMatch(NOT_FOUND)).toBe(false);
  });

  it("status === 0 (code invalide) : jamais une correspondance", () => {
    expect(isOpenFactsMatch(INVALID_CODE)).toBe(false);
  });

  it("trouvaille d'audit réelle — status === 0 même si le produit existe dans un projet FRÈRE distinct (Open Beauty Facts) : jamais une correspondance devinée", () => {
    expect(isOpenFactsMatch(FOUND_IN_SISTER_PROJECT)).toBe(false);
  });
});

describe("normalizeOpenFactsProduct", () => {
  it("Nutella (Open Food Facts) : champs catalogue reportés tels quels, jamais un prix", () => {
    const item = normalizeOpenFactsProduct(NUTELLA_FOUND, "open_food_facts", "https://world.openfoodfacts.org", "general");
    expect(item.source).toBe("open_food_facts");
    expect(item.externalId).toBe("3017620422003");
    expect(item.kind).toBe("barcode_product");
    expect(item.name).toBe("Nutella");
    expect(item.canonicalAttributes.brands).toBe("Nutella, Ferrero");
    expect(item.canonicalAttributes.quantity).toBe("400 g e");
    expect(item.images).toEqual(["https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.400.jpg"]);
    expect(item.externalUrl).toBe("https://world.openfoodfacts.org/product/3017620422003");
    expect(item.priceHints).toBeUndefined();
  });

  it("GEL WC (Open Products Facts) : même forme, hôte/source distincts", () => {
    const item = normalizeOpenFactsProduct(OPF_TOILET_GEL_FOUND, "open_products_facts", "https://world.openproductsfacts.org", "general");
    expect(item.source).toBe("open_products_facts");
    expect(item.canonicalAttributes.quantity).toBe("750 ml");
    expect(item.externalUrl).toBe("https://world.openproductsfacts.org/product/3450970084468");
  });

  it("image_front_url et image_url identiques : dédupliquées, jamais deux fois la même image", () => {
    const item = normalizeOpenFactsProduct(NUTELLA_FOUND, "open_food_facts", "https://world.openfoodfacts.org", "general");
    expect(item.images).toHaveLength(1);
  });

  it("aucun product_name : repli sur le code-barres, jamais un nom vide/inventé", () => {
    const noName = { code: "123", status: 1, product: {} };
    const item = normalizeOpenFactsProduct(noName, "open_food_facts", "https://world.openfoodfacts.org", "general");
    expect(item.name).toBe("123");
  });
});

describe("matchOpenFactsProduct", () => {
  it("confiance 1, matchedOn=['barcode'] — correspondance EXACTE uniquement, jamais partielle", () => {
    const match = matchOpenFactsProduct(NUTELLA_FOUND, "open_food_facts", "https://world.openfoodfacts.org", "general");
    expect(match.confidence).toBe(1);
    expect(match.matchedOn).toEqual(["barcode"]);
  });
});
