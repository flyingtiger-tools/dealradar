import { describe, expect, it } from "vitest";
import { deriveCollectorNumberForCatalogQuery } from "../derive-catalog-query-collector-number";

describe("deriveCollectorNumberForCatalogQuery", () => {
  it("096/094 : retire uniquement la partie /total, conserve le zéro de tête du numérateur", () => {
    expect(deriveCollectorNumberForCatalogQuery("096/094")).toBe("096");
  });

  it("58/102 : retire uniquement la partie /total", () => {
    expect(deriveCollectorNumberForCatalogQuery("58/102")).toBe("58");
  });

  it("carte secrète (numérateur > total) : même règle, aucun cas spécial", () => {
    expect(deriveCollectorNumberForCatalogQuery("201/165")).toBe("201");
  });

  it("numéro déjà normalisé (sans slash) : inchangé", () => {
    expect(deriveCollectorNumberForCatalogQuery("96")).toBe("96");
  });

  it("numéro promo/alphanumérique : inchangé, jamais modifié", () => {
    expect(deriveCollectorNumberForCatalogQuery("SWSH001")).toBe("SWSH001");
    expect(deriveCollectorNumberForCatalogQuery("SVP001")).toBe("SVP001");
  });

  it("format non reconnu contenant un slash (ex. Trainer Gallery alphanumérique) : inchangé, jamais un split deviné", () => {
    expect(deriveCollectorNumberForCatalogQuery("TG05/TG30")).toBe("TG05/TG30");
  });

  it("entrée invalide : null/undefined/chaîne vide → undefined, jamais une invention", () => {
    expect(deriveCollectorNumberForCatalogQuery(null)).toBeUndefined();
    expect(deriveCollectorNumberForCatalogQuery(undefined)).toBeUndefined();
    expect(deriveCollectorNumberForCatalogQuery("")).toBeUndefined();
  });

  it("non-régression : un numéro simple à un chiffre reste inchangé", () => {
    expect(deriveCollectorNumberForCatalogQuery("2")).toBe("2");
  });
});
