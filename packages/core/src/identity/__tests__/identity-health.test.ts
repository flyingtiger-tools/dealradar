import { describe, expect, it } from "vitest";
import { summarizeIdentityHealth, stripConflictedFields } from "../identity-health";
import { createCanonicalProductIdentity } from "../canonical-product-identity";
import { mergeIdentityEvidence } from "../merge-identity-evidence";
import { KNOWN_SOURCE_QUERY_PROFILES } from "../search-plan";

const ASOF = "2026-09-21T00:00:00.000Z";

function identityWith(fields: Record<string, string>) {
  return mergeIdentityEvidence(createCanonicalProductIdentity("apple", "apple:iphone-13"), { source: "test", confidence: 0.9, observedAt: ASOF, fields }).identity;
}

describe("stripConflictedFields", () => {
  it("aucun conflit -> identité inchangée", () => {
    const identity = identityWith({ brand: "Apple", upc: "111" });
    expect(stripConflictedFields(identity)).toEqual(identity);
  });

  it("retire UNIQUEMENT les champs en conflit, préserve les autres", () => {
    const first = identityWith({ upc: "111", brand: "Apple" });
    const second = mergeIdentityEvidence(first, { source: "other", confidence: 0.9, observedAt: ASOF, fields: { upc: "222" } }).identity;
    expect(second.conflicts).toHaveLength(1);

    const stripped = stripConflictedFields(second);
    expect(stripped.fields.upc).toBeUndefined();
    expect(stripped.fields.brand?.value).toBe("Apple"); // préservé
  });

  it("ne modifie JAMAIS identity.conflicts lui-même — l'identité originale reste la source de vérité", () => {
    const first = identityWith({ upc: "111" });
    const second = mergeIdentityEvidence(first, { source: "other", confidence: 0.9, observedAt: ASOF, fields: { upc: "222" } }).identity;
    const stripped = stripConflictedFields(second);
    expect(stripped.conflicts).toEqual(second.conflicts);
  });
});

describe("summarizeIdentityHealth", () => {
  it("aucun conflit, identifiant ASIN connu : Keepa est exactSearchable", () => {
    const identity = identityWith({ asin: "B0X" });
    const summary = summarizeIdentityHealth(identity, KNOWN_SOURCE_QUERY_PROFILES);
    expect(summary.unresolvedConflictCount).toBe(0);
    expect(summary.exactSearchableSources).toContain("keepa");
  });

  it("aucun identifiant, marque+modèle connus : eBay/Google Shopping en repli texte, Keepa/BrickLink/PriceCharting bloqués", () => {
    const identity = identityWith({ brand: "Apple", model: "iPhone 13" });
    const summary = summarizeIdentityHealth(identity, KNOWN_SOURCE_QUERY_PROFILES);
    expect(summary.fallbackOnlySources).toContain("ebay");
    expect(summary.blockedSourcesDueToIdentity).toContain("keepa");
    expect(summary.blockedSourcesDueToIdentity).toContain("bricklink");
  });

  it("identité totalement vide : toutes les sources bloquées", () => {
    const identity = createCanonicalProductIdentity("apple");
    const summary = summarizeIdentityHealth(identity, KNOWN_SOURCE_QUERY_PROFILES);
    expect(summary.blockedSourcesDueToIdentity).toEqual(KNOWN_SOURCE_QUERY_PROFILES.map((p) => p.source));
    expect(summary.exactSearchableSources).toEqual([]);
  });

  it("UPC en conflit : jamais utilisé pour une requête exacte tant que non résolu — la source qui en dépendait devient bloquée/repli, jamais silencieusement 'exacte'", () => {
    const first = identityWith({ upc: "111" });
    const conflicted = mergeIdentityEvidence(first, { source: "other", confidence: 0.9, observedAt: ASOF, fields: { upc: "222" } }).identity;

    const summary = summarizeIdentityHealth(conflicted, KNOWN_SOURCE_QUERY_PROFILES);
    expect(summary.unresolvedConflictCount).toBe(1);
    expect(summary.conflictFields).toEqual(["upc"]);
    // PriceCharting n'a plus d'UPC exploitable (contesté) et aucun autre identifiant -> bloqué, jamais "exact" sur une base contestée.
    expect(summary.exactSearchableSources).not.toContain("pricecharting");
  });

  it("identifierCoverage reflète la fraction de champs durs structurels connus", () => {
    const identity = identityWith({ upc: "111", ean: "222" }); // 2 des 7 champs structurels (mpn/gtin/ean/upc/asin/bricklinkNo/priceChartingId)
    const summary = summarizeIdentityHealth(identity, KNOWN_SOURCE_QUERY_PROFILES);
    expect(summary.identifierCoverage).toBeCloseTo(2 / 7, 5);
  });
});
