import { describe, expect, it } from "vitest";
import { buildSearchQueries } from "../search-query";

describe("buildSearchQueries", () => {
  it("construit une requête exacte avec tous les champs, la plus spécifique en premier", () => {
    const result = buildSearchQueries({
      brand: "Nike",
      model: "Air Jordan 1 Retro High",
      variant: "Chicago",
      identifiers: ["size 10"],
    });
    expect(result.exact).toBe("Nike Air Jordan 1 Retro High Chicago size 10");
  });

  it("propose des replis progressivement relâchés, jamais un doublon de exact", () => {
    const result = buildSearchQueries({
      brand: "Rolex",
      model: "Submariner",
      variant: "Black Dial",
      identifiers: ["ref 116610LN"],
    });
    expect(result.fallbacks).toContain("Rolex Submariner Black Dial");
    expect(result.fallbacks).toContain("Rolex Submariner");
    expect(result.fallbacks).toContain("Submariner");
    expect(result.fallbacks).not.toContain(result.exact);
    expect(new Set(result.fallbacks).size).toBe(result.fallbacks.length); // aucun doublon interne
  });

  it("brand seul absent : le modèle reste l'ancre, aucune trace de 'undefined'/'null'", () => {
    const result = buildSearchQueries({ brand: null, model: "PlayStation 5", variant: "Digital Edition" });
    expect(result.exact).toBe("PlayStation 5 Digital Edition");
    expect(result.exact).not.toMatch(/undefined|null/i);
    for (const fallback of result.fallbacks) expect(fallback).not.toMatch(/undefined|null/i);
  });

  it("model seul absent : le brand reste l'ancre, jamais un fallback vide ni 'brand model' avec un trou", () => {
    const result = buildSearchQueries({ brand: "Canon", model: null, identifiers: ["EOS R5"] });
    expect(result.exact).toBe("Canon EOS R5");
    expect(result.exact).not.toMatch(/\s{2,}/); // pas de double espace laissé par le champ manquant
    expect(result.fallbacks.every((f) => f.length > 0)).toBe(true);
  });

  it("aucun champ exploitable : exact vide, aucun fallback fabriqué à partir de rien", () => {
    const result = buildSearchQueries({});
    expect(result.exact).toBe("");
    expect(result.fallbacks).toEqual([]);
  });

  it("brand et model absents : replie sur variant puis titleFallback, jamais fabriqué", () => {
    const result = buildSearchQueries({ variant: "Millennium Falcon", titleFallback: "Grosse boîte LEGO Star Wars" });
    expect(result.exact).toBe("Millennium Falcon");
    expect(result.fallbacks).toEqual(["Grosse boîte LEGO Star Wars"]);
  });

  it("titleFallback est ignoré dès qu'un brand ou model existe (jamais un bruit de repli inutile)", () => {
    const result = buildSearchQueries({ brand: "Apple", titleFallback: "iPhone d'occasion pas cher" });
    expect(result.exact).toBe("Apple");
    expect(result.fallbacks).not.toContain("iPhone d'occasion pas cher");
  });

  it("nettoie les espaces superflus et les chaînes vides plutôt que de les traiter comme un vrai champ", () => {
    const result = buildSearchQueries({ brand: "  Sony   ", model: "  ", identifiers: ["", "  ", "PS5"] });
    expect(result.exact).toBe("Sony PS5");
    expect(result.exact).not.toMatch(/\s{2,}/);
  });

  it("est déterministe : mêmes entrées → même sortie", () => {
    const input = { brand: "Seiko", model: "Prospex", identifiers: ["SKX007"] };
    expect(buildSearchQueries(input)).toEqual(buildSearchQueries({ ...input, identifiers: [...input.identifiers] }));
  });
});
