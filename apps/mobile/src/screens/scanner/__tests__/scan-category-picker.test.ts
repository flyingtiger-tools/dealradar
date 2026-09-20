import { categorySlugSchema } from "@dealradar/contracts";
import { SCAN_CATEGORY_OPTIONS } from "../ScanCategoryPickerScreen";

/**
 * Tests de complétude du sélecteur de catégorie (LOT "rendre le scan
 * universel accessible dans l'app") — garantit qu'aucune catégorie connue
 * n'est absente du sélecteur (sinon inaccessible depuis l'interface,
 * contredisant le critère de succès du lot) et qu'aucune entrée fantôme
 * (catégorie inconnue de `CategorySlug`) n'y apparaît.
 */

describe("SCAN_CATEGORY_OPTIONS", () => {
  it("couvre exactement les catégories connues de CategorySlug, sans doublon", () => {
    const optionCategories = SCAN_CATEGORY_OPTIONS.map((o) => o.category);
    expect(new Set(optionCategories).size).toBe(optionCategories.length);
    expect([...optionCategories].sort()).toEqual([...categorySlugSchema.options].sort());
  });

  it("pokemon_tcg est présent, en premier (cas d'usage historique le plus fréquent)", () => {
    expect(SCAN_CATEGORY_OPTIONS[0]?.category).toBe("pokemon_tcg");
  });

  it("general est présent avec un libellé honnête ('Autre'), jamais masqué", () => {
    const general = SCAN_CATEGORY_OPTIONS.find((o) => o.category === "general");
    expect(general).toBeDefined();
    expect(general?.label).toBe("Autre");
  });

  it("chaque option porte un libellé non technique — jamais un slug brut affiché", () => {
    for (const option of SCAN_CATEGORY_OPTIONS) {
      expect(option.label).not.toBe(option.category);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
