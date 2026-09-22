import { describe, expect, it } from "vitest";
import { buildExactGtinQuery, normalizeSparqlGtinResults, matchSparqlGtinResults } from "../normalize";
import { IPHONE_7_GTIN_RESULT, EMPTY_RESULT } from "./fixtures/results";

describe("buildExactGtinQuery", () => {
  it("construit une requête SPARQL EXACTE sur wdt:P3962, jamais une recherche floue", () => {
    const query = buildExactGtinQuery("00640520098905");
    expect(query).toContain('wdt:P3962 "00640520098905"');
    expect(query).not.toMatch(/CONTAINS|regex|FILTER/i);
  });

  it("échappe les guillemets/antislash dans le GTIN, jamais une injection SPARQL", () => {
    const query = buildExactGtinQuery('x"; DROP');
    expect(query).toContain('wdt:P3962 "x\\"; DROP"');
  });
});

describe("normalizeSparqlGtinResults", () => {
  it("résultat réel (iPhone 7) : un CatalogItem, jamais un prix", () => {
    const items = normalizeSparqlGtinResults(IPHONE_7_GTIN_RESULT, "00640520098905", "apple");
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("wikidata");
    expect(items[0]!.externalId).toBe("Q29972750");
    expect(items[0]!.kind).toBe("wikidata_entity");
    expect(items[0]!.name).toBe("Apple iPhone 7 128GB Jet Black");
    expect(items[0]!.canonicalAttributes.manufacturer).toBe("Apple Inc.");
    expect(items[0]!.canonicalAttributes.gtin).toBe("00640520098905");
    expect(items[0]!.externalUrl).toBe("http://www.wikidata.org/entity/Q29972750");
    expect(items[0]!.priceHints).toBeUndefined();
  });

  it("résultat vide : tableau vide, jamais un item inventé", () => {
    expect(normalizeSparqlGtinResults(EMPTY_RESULT, "0000000000000", "general")).toEqual([]);
  });
});

describe("matchSparqlGtinResults", () => {
  it("confiance 1, matchedOn=['gtin'] — correspondance exacte déjà faite côté serveur", () => {
    const matches = matchSparqlGtinResults(IPHONE_7_GTIN_RESULT, "00640520098905", "apple");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.confidence).toBe(1);
    expect(matches[0]!.matchedOn).toEqual(["gtin"]);
  });
});
