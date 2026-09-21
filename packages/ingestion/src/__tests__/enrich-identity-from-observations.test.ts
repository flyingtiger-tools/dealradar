import { describe, expect, it } from "vitest";
import type { MarketObservation } from "@dealradar/connectors";
import { createCanonicalProductIdentity, mergeIdentityEvidence } from "@dealradar/core";
import { enrichIdentityFromObservations, deriveIdentityEvidenceFromObservation } from "../enrich-identity-from-observations";

const ASOF = "2026-09-21T00:00:00.000Z";

function fakeObservation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    source: "keepa",
    sourceItemId: "B0X",
    sourceUrl: null,
    observedAt: ASOF,
    productKey: null,
    query: "iphone 13",
    title: "Apple iPhone 13",
    brand: "Apple",
    model: "iPhone 13",
    variant: null,
    identifiers: {},
    condition: "new",
    completeness: null,
    priceAmountCents: 50000,
    currency: "CHF",
    shippingCostCents: null,
    totalPriceCents: null,
    country: "CH",
    marketplace: "amazon",
    evidenceType: "retailPrices",
    evidenceTier: "B",
    soldAt: null,
    matchScore: 0.95,
    rawMetadataRef: null,
    ingestionVersion: 1,
    ...overrides,
  };
}

describe("deriveIdentityEvidenceFromObservation", () => {
  it("Keepa fournit un ASIN structuré -> preuve d'identité produite avec ce champ dur", () => {
    const observation = fakeObservation({ identifiers: { asin: "B0X99999" } });
    const evidence = deriveIdentityEvidenceFromObservation(observation);
    expect(evidence?.fields.asin).toBe("B0X99999");
    expect(evidence?.source).toBe("keepa");
  });

  it("BrickLink fournit un numéro de set -> preuve d'identité avec bricklinkNo", () => {
    const observation = fakeObservation({ source: "bricklink", identifiers: { bricklinkNo: "10300-1" } });
    const evidence = deriveIdentityEvidenceFromObservation(observation);
    expect(evidence?.fields.bricklinkNo).toBe("10300-1");
  });

  it("un identifiant non structuré (ex. googleProductId) devient un ALIAS, jamais forcé dans un champ dur", () => {
    const observation = fakeObservation({ source: "dataforseo_google_shopping", identifiers: { googleProductId: "gp-1" } });
    const evidence = deriveIdentityEvidenceFromObservation(observation);
    expect(evidence?.fields).toEqual({});
    expect(evidence?.aliases).toEqual([{ field: "googleProductId", value: "gp-1" }]);
  });

  it("aucun identifiant structuré fourni par la source (titre libre seul) -> AUCUNE preuve fabriquée, jamais un GTIN/MPN deviné", () => {
    const observation = fakeObservation({ source: "ebay", identifiers: {} });
    const evidence = deriveIdentityEvidenceFromObservation(observation);
    expect(evidence).toBeNull();
  });
});

describe("enrichIdentityFromObservations", () => {
  it("enrichit une identité vide avec un ASIN Keepa", () => {
    const identity = createCanonicalProductIdentity("apple", "apple:iphone-13");
    const result = enrichIdentityFromObservations(identity, [fakeObservation({ identifiers: { asin: "B0X99999" } })]);
    expect(result.identity.fields.asin?.value).toBe("B0X99999");
    expect(result.observationsWithIdentifiers).toBe(1);
    expect(result.newConflicts).toEqual([]);
  });

  it("un UPC en désaccord avec l'existant est enregistré comme CONFLIT, la claim d'origine n'est jamais écrasée", () => {
    const identity = mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), {
      source: "ebay",
      confidence: 0.9,
      observedAt: ASOF,
      fields: { upc: "111111111111" },
    }).identity;

    const result = enrichIdentityFromObservations(identity, [fakeObservation({ source: "google_shopping", identifiers: { upc: "222222222222" } })]);
    expect(result.identity.fields.upc?.value).toBe("111111111111");
    expect(result.newConflicts).toHaveLength(1);
    expect(result.newConflicts[0]?.field).toBe("upc");
  });

  it("plusieurs observations sans identifiant structuré -> aucun enrichissement, aucun crash", () => {
    const identity = createCanonicalProductIdentity("apple", "apple:iphone-13");
    const result = enrichIdentityFromObservations(identity, [fakeObservation({ source: "ebay", identifiers: {} }), fakeObservation({ source: "google_shopping", identifiers: {} })]);
    expect(result.identity).toEqual(identity);
    expect(result.observationsWithIdentifiers).toBe(0);
  });
});
