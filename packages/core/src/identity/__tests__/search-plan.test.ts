import { describe, expect, it } from "vitest";
import { buildSearchPlan, buildSearchPlans, KNOWN_SOURCE_QUERY_PROFILES } from "../search-plan";
import { createCanonicalProductIdentity } from "../canonical-product-identity";
import { mergeIdentityEvidence } from "../merge-identity-evidence";
import type { IdentityEvidence } from "../merge-identity-evidence";

const ASOF = "2026-09-21T00:00:00.000Z";

function identityWith(fields: IdentityEvidence["fields"]): ReturnType<typeof createCanonicalProductIdentity> {
  const base = createCanonicalProductIdentity("apple");
  return mergeIdentityEvidence(base, { source: "test", confidence: 0.9, observedAt: ASOF, fields }).identity;
}

function profileFor(source: string) {
  return KNOWN_SOURCE_QUERY_PROFILES.find((p) => p.source === source)!;
}

describe("buildSearchPlan — priorité par identifiant d'abord", () => {
  it("iPhone EAN exact (Keepa) : utilise l'EAN comme hint dédié, jamais un texte libre", () => {
    const identity = identityWith({ ean: "0194252707326", brand: "Apple", model: "iPhone 13" });
    const plan = buildSearchPlan(identity, profileFor("keepa"));

    expect(plan).not.toBeNull();
    expect(plan!.exactness).toBe("structural_identifier");
    expect(plan!.hints).toEqual({ ean: "0194252707326" });
    expect(plan!.identifiersUsed).toEqual(["ean"]);
  });

  it("iPhone avec ASIN connu (Keepa) : l'ASIN natif prime sur l'EAN", () => {
    const identity = identityWith({ asin: "B0BDJH4MZX", ean: "0194252707326" });
    const plan = buildSearchPlan(identity, profileFor("keepa"));
    expect(plan!.exactness).toBe("source_native_id");
    expect(plan!.hints).toEqual({ asin: "B0BDJH4MZX" });
  });

  it("LEGO numéro de set (BrickLink) : utilise bricklinkNo comme hint natif", () => {
    const identity = identityWith({ bricklinkNo: "10300", brand: "LEGO" });
    const plan = buildSearchPlan(identity, profileFor("bricklink"));
    expect(plan!.exactness).toBe("source_native_id");
    expect(plan!.hints).toEqual({ bricklinkNo: "10300" });
  });

  it("jeu vidéo UPC (PriceCharting) : utilise l'UPC comme hint dédié", () => {
    const identity = identityWith({ upc: "045496883254", brand: "Nintendo", model: "Super Mario 64" });
    const plan = buildSearchPlan(identity, profileFor("pricecharting"));
    expect(plan!.hints).toEqual({ upc: "045496883254" });
  });

  it("priceChartingId natif prime sur l'UPC pour PriceCharting", () => {
    const identity = identityWith({ priceChartingId: "6910", upc: "045496883254" });
    const plan = buildSearchPlan(identity, profileFor("pricecharting"));
    expect(plan!.exactness).toBe("source_native_id");
    expect(plan!.hints).toEqual({ priceChartingId: "6910" });
  });

  it("Google Shopping (moteur mots-clés) : envoie l'UPC/EAN COMME TEXTE de requête exact, jamais un hint inexistant", () => {
    const identity = identityWith({ upc: "045496883254", brand: "Nintendo", model: "Super Mario 64" });
    const plan = buildSearchPlan(identity, profileFor("google_shopping"));
    expect(plan!.q).toBe("045496883254");
    expect(plan!.hints).toEqual({});
    expect(plan!.exactness).toBe("structural_identifier");
  });

  it("sans identifiant mais avec marque+modèle+variante exacts (eBay) : repli niveau 3", () => {
    const identity = identityWith({ brand: "Apple", model: "iPhone 13", variant: "128GB Bleu" });
    const plan = buildSearchPlan(identity, profileFor("ebay"));
    expect(plan!.exactness).toBe("exact_attributes");
    expect(plan!.q).toBe("Apple iPhone 13 128GB Bleu");
  });

  it("marque seule (sans modèle) : repli contraint niveau 4", () => {
    const identity = identityWith({ brand: "Apple" });
    const plan = buildSearchPlan(identity, profileFor("ebay"));
    expect(plan!.exactness).toBe("constrained_fallback");
    expect(plan!.q).toBe("Apple");
  });

  it("AUCUNE information exploitable -> null, jamais une requête 'poubelle'", () => {
    const identity = createCanonicalProductIdentity("apple");
    const plan = buildSearchPlan(identity, profileFor("ebay"));
    expect(plan).toBeNull();
  });

  it("source n'acceptant que des identifiants exacts (Keepa/BrickLink/PriceCharting) : sans identifiant, null même avec marque+modèle connus, jamais une recherche par mots-clés inventée", () => {
    const identity = identityWith({ brand: "Apple", model: "iPhone 13" });
    expect(buildSearchPlan(identity, profileFor("keepa"))).toBeNull();
    expect(buildSearchPlan(identity, profileFor("bricklink"))).toBeNull();
    expect(buildSearchPlan(identity, profileFor("pricecharting"))).toBeNull();
  });

  it("jamais un identifiant inventé — un champ absent de l'identité n'apparaît jamais dans le plan", () => {
    const identity = identityWith({ brand: "Apple", model: "iPhone 13" });
    const plan = buildSearchPlan(identity, profileFor("keepa"));
    expect(plan).toBeNull(); // pas d'ASIN/UPC/EAN connu -> jamais deviné
  });
});

describe("buildSearchPlans", () => {
  it("construit un plan par source, omet silencieusement les sources sans plan atteignable", () => {
    const identity = identityWith({ ean: "0194252707326" }); // seul Keepa/eBay/Google Shopping/DataForSEO peuvent l'utiliser, pas BrickLink/PriceCharting
    const plans = buildSearchPlans(identity, KNOWN_SOURCE_QUERY_PROFILES);
    expect(plans.map((p) => p.source)).not.toContain("bricklink");
    expect(plans.map((p) => p.source)).not.toContain("pricecharting");
    expect(plans.map((p) => p.source)).toContain("keepa");
  });

  it("identité totalement vide -> aucun plan pour aucune source", () => {
    const identity = createCanonicalProductIdentity("apple");
    expect(buildSearchPlans(identity, KNOWN_SOURCE_QUERY_PROFILES)).toEqual([]);
  });
});
