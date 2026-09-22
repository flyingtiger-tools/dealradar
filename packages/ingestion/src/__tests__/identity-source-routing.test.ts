import { describe, expect, it } from "vitest";
import { routeIdentitySources } from "../identity-source-routing";

describe("routeIdentitySources", () => {
  it("aucun indice : tableau vide, jamais une source devinée", () => {
    expect(routeIdentitySources({})).toEqual([]);
  });

  it("carte TCG : uniquement TCGdex, jamais dupliqué avec un autre indice même s'il est aussi fourni", () => {
    const entries = routeIdentitySources({ isTcgCard: true, barcode: "123", legoSetNumber: "10300" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe("tcgdex");
  });

  it("code-barres exact : Open Food Facts AVANT Open Products Facts, jamais l'inverse", () => {
    const entries = routeIdentitySources({ barcode: "3017620422003" });
    const sources = entries.map((e) => e.source);
    expect(sources.indexOf("open_food_facts")).toBeLessThan(sources.indexOf("open_products_facts"));
  });

  it("code-barres exact : Wikidata AVANT upc.dev, jamais l'inverse (upc.dev reste payant-par-clé, quota quotidien limité)", () => {
    const entries = routeIdentitySources({ barcode: "3017620422003" });
    const sources = entries.map((e) => e.source);
    expect(sources.indexOf("wikidata")).toBeLessThan(sources.indexOf("upcdev"));
  });

  it("code-barres exact : upc.dev TOUJOURS en TOUT dernier (repli de second rang payant-par-clé, LOT 'Live Identity Enrichment...', section 3)", () => {
    const entries = routeIdentitySources({ barcode: "3017620422003" });
    expect(entries[entries.length - 1]!.source).toBe("upcdev");
  });

  it("numéro de set LEGO exact : Rebrickable proposé, catégorie 'lego'", () => {
    const entries = routeIdentitySources({ legoSetNumber: "10300-1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe("rebrickable");
    expect(entries[0]!.categorySlug).toBe("lego");
  });

  it("titre de jeu exact : IGDB proposé mais sa raison documente explicitement le verrou commercial", () => {
    const entries = routeIdentitySources({ gamingTitle: "Halo Infinite" });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe("igdb");
    expect(entries[0]!.reason).toMatch(/VERROUILLÉ/);
  });

  it("plusieurs indices à la fois (hors TCG) : chaque source concernée ajoutée, jamais une seule choisie arbitrairement", () => {
    const entries = routeIdentitySources({ barcode: "123", legoSetNumber: "10300" });
    const sources = entries.map((e) => e.source);
    expect(sources).toContain("open_food_facts");
    expect(sources).toContain("open_products_facts");
    expect(sources).toContain("rebrickable");
    expect(sources).toContain("wikidata");
    expect(sources).toContain("upcdev");
  });

  it("aucune source de PRIX (open_prices, ebay, etc.) n'apparaît jamais dans ce routage d'identité", () => {
    const entries = routeIdentitySources({ barcode: "123", legoSetNumber: "10300", gamingTitle: "x" });
    const sources = entries.map((e) => e.source);
    expect(sources).not.toContain("open_prices");
    expect(sources).not.toContain("ebay");
  });
});
