import { categorySlugSchema } from "@dealradar/contracts";
import { resolveScannerBody } from "../scanner-routing";

/**
 * Tests de routage Scanner (LOT "rendre le scan universel accessible dans
 * l'app") — garantissent, à froid, qu'aucune catégorie non-Pokémon ne peut
 * silencieusement se retrouver routée vers le corps "pokemon_tcg", et que
 * `pokemon_tcg` n'est jamais routée vers "universal".
 */

const ALL_CATEGORIES = categorySlugSchema.options;

describe("resolveScannerBody", () => {
  it("category null : sélecteur de catégorie", () => {
    expect(resolveScannerBody(null)).toBe("picker");
  });

  it("pokemon_tcg : routé vers le corps pokemon_tcg (TcgScanScreen inchangé)", () => {
    expect(resolveScannerBody("pokemon_tcg")).toBe("pokemon_tcg");
  });

  it("toute catégorie non-Pokémon : routée vers universal, jamais vers pokemon_tcg", () => {
    const nonTcg = ALL_CATEGORIES.filter((c) => c !== "pokemon_tcg");
    expect(nonTcg.length).toBeGreaterThan(0);
    for (const category of nonTcg) {
      expect(resolveScannerBody(category)).toBe("universal");
    }
  });

  it("general : routée vers universal comme toute autre catégorie non-Pokémon", () => {
    expect(resolveScannerBody("general")).toBe("universal");
  });

  it("couvre exactement les 10 catégories connues, aucun résultat 'picker' pour une catégorie non-null", () => {
    for (const category of ALL_CATEGORIES) {
      expect(resolveScannerBody(category)).not.toBe("picker");
    }
  });
});
