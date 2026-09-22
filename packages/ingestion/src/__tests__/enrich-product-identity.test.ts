import { describe, expect, it, vi } from "vitest";
import { enrichProductIdentity, deriveIdentityFieldsFromCatalogItem } from "../enrich-product-identity";
import type { CatalogItem, CatalogMatch } from "@dealradar/connectors";

const ASOF = "2026-09-22T00:00:00.000Z";

function fakeMatch(item: Partial<CatalogItem>, confidence = 1): CatalogMatch {
  return {
    item: { source: "open_food_facts", externalId: "x", kind: "barcode_product", categorySlug: "apple", name: "x", canonicalAttributes: {}, images: [], externalUrl: null, ...item },
    confidence,
    matchedOn: ["barcode"],
  };
}

describe("deriveIdentityFieldsFromCatalogItem", () => {
  it("open_food_facts/open_products_facts : GTIN + capacité si un motif GB/TB explicite existe dans le nom, JAMAIS de marque/modèle", () => {
    const fields = deriveIdentityFieldsFromCatalogItem(
      { source: "open_food_facts", externalId: "3017620422003", kind: "barcode_product", categorySlug: "apple", name: "Apple iPhone 15 Pro 256GB", canonicalAttributes: { brands: "Apple, Reseller Inc" }, images: [], externalUrl: null },
      "3017620422003",
    );
    expect(fields).toEqual({ gtin: "3017620422003", storage: "256GB" });
    expect(fields.brand).toBeUndefined();
    expect(fields.model).toBeUndefined();
  });

  it("wikidata : GTIN + marque (manufacturer, champ structuré) + capacité", () => {
    const fields = deriveIdentityFieldsFromCatalogItem(
      { source: "wikidata", externalId: "Q29972750", kind: "wikidata_entity", categorySlug: "apple", name: "Apple iPhone 7 128GB Jet Black", canonicalAttributes: { manufacturer: "Apple Inc." }, images: [], externalUrl: null },
      "00640520098905",
    );
    expect(fields).toEqual({ gtin: "00640520098905", brand: "Apple Inc.", storage: "128GB" });
  });

  it("rebrickable : numéro de set (suffixe -1 retiré) -> bricklinkNo, nom du set -> model", () => {
    const fields = deriveIdentityFieldsFromCatalogItem(
      { source: "rebrickable", externalId: "75192-1", kind: "lego_set", categorySlug: "lego", name: "Millennium Falcon UCS", canonicalAttributes: { setNumber: "75192-1" }, images: [], externalUrl: null },
      null,
    );
    expect(fields).toEqual({ bricklinkNo: "75192", model: "Millennium Falcon UCS" });
  });

  it("upcdev : même traitement conservateur qu'open_food_facts/open_products_facts — GTIN + capacité si motif GB/TB explicite, JAMAIS de marque/modèle", () => {
    const fields = deriveIdentityFieldsFromCatalogItem(
      { source: "upcdev", externalId: "0049000042566", kind: "generic_product", categorySlug: "general", name: "Apple iPhone 15 Pro 256GB", canonicalAttributes: { brand: "Apple" }, images: [], externalUrl: null },
      "0049000042566",
    );
    expect(fields).toEqual({ gtin: "0049000042566", storage: "256GB" });
    expect(fields.brand).toBeUndefined();
    expect(fields.model).toBeUndefined();
  });

  it("aucun motif GB/TB dans le nom : storage absent, jamais une capacité inventée", () => {
    const fields = deriveIdentityFieldsFromCatalogItem(
      { source: "wikidata", externalId: "Q1", kind: "wikidata_entity", categorySlug: "general", name: "Coca-Cola", canonicalAttributes: {}, images: [], externalUrl: null },
      "500112548280",
    );
    expect(fields.storage).toBeUndefined();
  });
});

describe("enrichProductIdentity — politique de fusion (section 5 du brief)", () => {
  it("EXEMPLE 1 : AI dit 'iPhone 15 Pro' (aucune capacité) + GTIN dit '256GB' -> storage enrichi, JAMAIS de conflit", async () => {
    const lookup = vi.fn().mockImplementation(async (source: string) => {
      if (source === "open_food_facts") return [fakeMatch({ source: "open_food_facts", name: "Apple iPhone 15 Pro 256GB", canonicalAttributes: {} })];
      return [];
    });

    const result = await enrichProductIdentity({
      categorySlug: "apple",
      hints: { barcode: "3017620422003" },
      aiFields: { brand: "Apple", model: "iPhone 15 Pro" },
      asOf: ASOF,
      lookup,
    });

    expect(result.mergedFields.storage).toBe("256GB");
    expect(result.hadConflict).toBe(false);
    expect(result.qualityMethod).toBe("barcode_confirmed");
  });

  it("EXEMPLE 2 (LE PLUS IMPORTANT) : AI dit 128GB mais le GTIN exact dit 256GB -> le GTIN GAGNE, conflit journalisé", async () => {
    const lookup = vi.fn().mockImplementation(async (source: string) => {
      if (source === "open_food_facts") return [fakeMatch({ source: "open_food_facts", name: "Apple iPhone 15 Pro 256GB", canonicalAttributes: {} })];
      return [];
    });

    const result = await enrichProductIdentity({
      categorySlug: "apple",
      hints: { barcode: "3017620422003" },
      aiFields: { storage: "128GB" },
      asOf: ASOF,
      lookup,
    });

    expect(result.mergedFields.storage).toBe("256GB"); // le GTIN gagne, jamais l'IA
    expect(result.hadConflict).toBe(true);
    const conflict = result.identity.conflicts.find((c) => c.field === "storage");
    expect(conflict).toBeDefined();
    expect(conflict!.claims.map((c) => c.value).sort()).toEqual(["128GB", "256GB"]);
  });

  it("EXEMPLE 3 : Rebrickable set 75192 + AI 'Millennium Falcon' -> fusionné (bricklinkNo du catalogue, model conservé du catalogue car confiance plus élevée que l'IA)", async () => {
    const lookup = vi.fn().mockImplementation(async (source: string) => {
      if (source === "rebrickable") return [fakeMatch({ source: "rebrickable", externalId: "75192-1", kind: "lego_set", categorySlug: "lego", name: "Millennium Falcon UCS", canonicalAttributes: { setNumber: "75192-1" } })];
      return [];
    });

    const result = await enrichProductIdentity({
      categorySlug: "lego",
      hints: { legoSetNumber: "75192" },
      aiFields: { model: "Millennium Falcon" },
      asOf: ASOF,
      lookup,
    });

    expect(result.mergedFields.bricklinkNo).toBe("75192");
    expect(result.mergedFields.model).toBe("Millennium Falcon UCS"); // catalogue (0.95) > IA (0.6) sur un champ DOUX
    expect(result.qualityMethod).toBe("lego_catalog_confirmed");
  });

  it("EXEMPLE 4 : identité ambiguë (PLUSIEURS résultats à confiance maximale pour le même indice) -> REJETÉE, jamais une supposition", async () => {
    const lookup = vi.fn().mockImplementation(async (source: string) => {
      if (source === "wikidata") {
        return [fakeMatch({ source: "wikidata", externalId: "Q1", name: "Produit A" }), fakeMatch({ source: "wikidata", externalId: "Q2", name: "Produit B" })];
      }
      return [];
    });

    const result = await enrichProductIdentity({
      categorySlug: "general",
      hints: { barcode: "0000000000000" },
      aiFields: { brand: "MaMarque" },
      asOf: ASOF,
      lookup,
    });

    expect(result.mergedFields.brand).toBe("MaMarque"); // rien du catalogue ambigu, l'IA reste seule source
    expect(result.qualityMethod).toBe("visual_only");
  });

  it("aucune correspondance nulle part : repli entier sur l'IA, qualityMethod='visual_only', jamais un conflit fabriqué", async () => {
    const lookup = vi.fn().mockResolvedValue([]);

    const result = await enrichProductIdentity({
      categorySlug: "watches",
      hints: {},
      aiFields: { brand: "Rolex", model: "Submariner" },
      asOf: ASOF,
      lookup,
    });

    expect(result.mergedFields).toEqual({ brand: "Rolex", model: "Submariner" });
    expect(result.qualityMethod).toBe("visual_only");
    expect(result.hadConflict).toBe(false);
    expect(result.sourcesConsulted).toEqual([]);
  });

  it("panne d'UNE source catalogue : isolée, jamais bloquante, consultée quand même honnêtement comptée", async () => {
    const lookup = vi.fn().mockImplementation(async (source: string) => {
      if (source === "open_food_facts") throw new Error("panne réseau simulée");
      return [];
    });

    const result = await enrichProductIdentity({ categorySlug: "general", hints: { barcode: "123" }, aiFields: {}, asOf: ASOF, lookup });

    expect(result.sourcesConsulted).toContain("open_food_facts");
    expect(result.qualityMethod).toBe("visual_only");
  });

  it("aucun lookup en double pour le même groupe (code-barres) une fois résolu — Open Food Facts confirme, Open Products Facts/Wikidata/upc.dev JAMAIS interrogées", async () => {
    const lookup = vi.fn().mockImplementation(async (source: string) => {
      if (source === "open_food_facts") return [fakeMatch({ source: "open_food_facts", name: "Nutella" })];
      return [];
    });

    const result = await enrichProductIdentity({ categorySlug: "general", hints: { barcode: "3017620422003" }, aiFields: {}, asOf: ASOF, lookup });

    expect(result.sourcesConsulted).toEqual(["open_food_facts"]);
    expect(result.sourcesSkipped).toEqual(["open_products_facts", "wikidata", "upcdev"]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("upc.dev (LOT 'Live Identity Enrichment...', section 3) : consulté SEULEMENT en dernier recours, quand Open Food Facts/Open Products Facts/Wikidata n'ont RIEN trouvé", async () => {
    const lookup = vi.fn().mockImplementation(async (source: string) => {
      if (source === "upcdev") return [fakeMatch({ source: "upcdev", kind: "generic_product", name: "Produit générique 256GB", canonicalAttributes: {} })];
      return [];
    });

    const result = await enrichProductIdentity({ categorySlug: "general", hints: { barcode: "1234567890123" }, aiFields: { brand: "MaMarque" }, asOf: ASOF, lookup });

    expect(lookup).toHaveBeenCalledTimes(4); // open_food_facts, open_products_facts, wikidata, PUIS upcdev
    expect(result.sourcesConsulted).toEqual(["open_food_facts", "open_products_facts", "wikidata", "upcdev"]);
    expect(result.mergedFields.storage).toBe("256GB");
    expect(result.qualityMethod).toBe("barcode_confirmed");
  });

  it("carte TCG (isTcgCard) : filet de sécurité défensif — TCGdex jamais interrogé par ce module même si le routage l'inclut (la verticale TCG a son propre pipeline, jamais atteint ce module en pratique)", async () => {
    const lookup = vi.fn();
    const result = await enrichProductIdentity({ categorySlug: "pokemon_tcg", hints: { isTcgCard: true }, aiFields: {}, asOf: ASOF, lookup });
    expect(lookup).not.toHaveBeenCalled();
    expect(result.sourcesSkipped).toEqual(["tcgdex"]);
    expect(result.qualityMethod).toBe("visual_only");
  });
});
