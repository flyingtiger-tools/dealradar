import { describe, expect, it } from "vitest";
import { normalizeEbayAspects } from "../attribute-mapping";

/**
 * Tests du mapping item specifics eBay -> attributs DealRadar (LOT "Données
 * marché réelles + préparation E2E") — résout la limite documentée depuis
 * le LOT "Universal Object Valuation Foundation" (`normalize.test.ts`
 * portait jusqu'ici un test explicite du comportement INVERSE, "aucune
 * correspondance").
 */

describe("normalizeEbayAspects", () => {
  it("mappe les alias connus vers leur clé canonique DealRadar", () => {
    const attrs = normalizeEbayAspects([
      { name: "Brand", value: "Apple" },
      { name: "Model", value: "iPhone 14 Pro" },
      { name: "Storage Capacity", value: "256 GB" },
      { name: "Color", value: "Deep Purple" },
    ]);
    expect(attrs).toEqual({ brand: "apple", model: "iphone 14 pro", storageGb: 256, color: "deep purple" });
  });

  it("est insensible à la casse et tolère les variantes de nom connues (ex. Colour vs Color)", () => {
    expect(normalizeEbayAspects([{ name: "colour", value: "Black" }])).toEqual({ color: "black" });
    expect(normalizeEbayAspects([{ name: "MANUFACTURER", value: "Rolex" }])).toEqual({ brand: "rolex" });
  });

  it("convertit la capacité de stockage en Go pour GB/TB/MB, jamais une unité devinée si absente", () => {
    expect(normalizeEbayAspects([{ name: "Storage Capacity", value: "1 TB" }])).toEqual({ storageGb: 1024 });
    expect(normalizeEbayAspects([{ name: "Storage Capacity", value: "512GB" }])).toEqual({ storageGb: 512 });
    // Pas d'unité reconnue dans la valeur -> reste une chaîne, jamais une unité supposée.
    expect(normalizeEbayAspects([{ name: "Storage Capacity", value: "256" }])).toEqual({ storageGb: "256" });
  });

  it("convertit le nombre de pièces LEGO en entier, tolère les séparateurs de milliers", () => {
    expect(normalizeEbayAspects([{ name: "Number of Pieces", value: "1,309" }])).toEqual({ piecesCount: 1309 });
    expect(normalizeEbayAspects([{ name: "Pieces", value: "7541" }])).toEqual({ piecesCount: 7541 });
  });

  it("mappe le numéro de set LEGO", () => {
    expect(normalizeEbayAspects([{ name: "Set Number", value: "75192" }])).toEqual({ setNumber: "75192" });
  });

  it("conserve un aspect non reconnu sous son propre nom normalisé, jamais perdu ni forcé sur une clé de profil", () => {
    expect(normalizeEbayAspects([{ name: "Screen Size", value: "6.1 in" }])).toEqual({ "screen size": "6.1 in" });
  });

  it("ne mappe jamais un nom d'aspect générique/ambigu (ex. 'Type', utilisé différemment selon la catégorie)", () => {
    const attrs = normalizeEbayAspects([{ name: "Type", value: "Smartphone" }]);
    expect(attrs).toEqual({ type: "smartphone" }); // conservé sous son nom brut, jamais mappé vers gearType/componentType/itemType
  });

  it("ignore un aspect sans nom ou sans valeur, jamais une clé vide ni une valeur inventée", () => {
    expect(normalizeEbayAspects([{ name: undefined, value: "x" }])).toEqual({});
    expect(normalizeEbayAspects([{ name: "Brand", value: undefined }])).toEqual({});
    expect(normalizeEbayAspects([{ name: "  ", value: "x" }])).toEqual({});
    expect(normalizeEbayAspects([{ name: "Brand", value: "  " }])).toEqual({});
  });

  it("liste vide ou absente : objet vide, jamais une exception", () => {
    expect(normalizeEbayAspects([])).toEqual({});
    expect(normalizeEbayAspects(undefined)).toEqual({});
  });

  it("plusieurs aspects reconnus dans la même liste sont tous mappés", () => {
    const attrs = normalizeEbayAspects([
      { name: "MPN", value: "A2890" },
      { name: "EAN", value: "0194253000000" },
      { name: "UPC", value: "194253000000" },
      { name: "Region of Manufacture", value: "China" },
      { name: "Language", value: "English" },
    ]);
    expect(attrs).toEqual({
      mpn: "a2890",
      ean: "0194253000000",
      upc: "194253000000",
      region: "china",
      language: "english",
    });
  });
});
