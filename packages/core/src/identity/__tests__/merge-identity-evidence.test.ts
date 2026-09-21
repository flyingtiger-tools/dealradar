import { describe, expect, it } from "vitest";
import { createCanonicalProductIdentity } from "../canonical-product-identity";
import { mergeIdentityEvidence, resolveIdentityConflict } from "../merge-identity-evidence";
import type { IdentityEvidence } from "../merge-identity-evidence";

const ASOF = "2026-09-21T00:00:00.000Z";

function evidence(overrides: Partial<IdentityEvidence> = {}): IdentityEvidence {
  return { source: "ai_identification", confidence: 0.8, observedAt: ASOF, fields: {}, ...overrides };
}

describe("mergeIdentityEvidence", () => {
  it("enrichit un champ manquant, jamais un conflit sur un champ vide", () => {
    const identity = createCanonicalProductIdentity("apple");
    const result = mergeIdentityEvidence(identity, evidence({ fields: { brand: "Apple", model: "iPhone 13" } }));

    expect(result.identity.fields.brand?.value).toBe("Apple");
    expect(result.identity.fields.model?.value).toBe("iPhone 13");
    expect(result.newConflicts).toEqual([]);
  });

  it("même valeur affirmée deux fois (casse/espaces différents) -> jamais un conflit", () => {
    const identity = createCanonicalProductIdentity("apple");
    const first = mergeIdentityEvidence(identity, evidence({ fields: { upc: "0194252707326" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ source: "ebay", fields: { upc: "  0194252707326  " } }));

    expect(second.newConflicts).toEqual([]);
    expect(second.identity.conflicts).toEqual([]);
  });

  it("UPC différent affirmé par deux sources -> CONFLIT explicite, jamais un écrasement silencieux", () => {
    const identity = createCanonicalProductIdentity("apple");
    const first = mergeIdentityEvidence(identity, evidence({ source: "ebay", fields: { upc: "111111111111" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ source: "google_shopping", fields: { upc: "222222222222" } }));

    expect(second.newConflicts).toHaveLength(1);
    expect(second.newConflicts[0]!.field).toBe("upc");
    // La claim existante n'est JAMAIS remplacée silencieusement par le conflit.
    expect(second.identity.fields.upc?.value).toBe("111111111111");
    expect(second.identity.fields.upc?.source).toBe("ebay");
  });

  it("mauvais stockage (storage) -> conflit dur, même règle que UPC", () => {
    const identity = createCanonicalProductIdentity("apple");
    const first = mergeIdentityEvidence(identity, evidence({ fields: { storage: "128GB" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ fields: { storage: "256GB" } }));

    expect(second.newConflicts.map((c) => c.field)).toContain("storage");
  });

  it("numéro de set LEGO (bricklinkNo) différent -> conflit dur", () => {
    const identity = createCanonicalProductIdentity("lego");
    const first = mergeIdentityEvidence(identity, evidence({ fields: { bricklinkNo: "10300" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ fields: { bricklinkNo: "75192" } }));

    expect(second.newConflicts.map((c) => c.field)).toContain("bricklinkNo");
  });

  it("champ DOUX en désaccord : la claim la plus digne de confiance l'emporte, jamais un conflit ni un blocage", () => {
    const identity = createCanonicalProductIdentity("apple");
    const first = mergeIdentityEvidence(identity, evidence({ source: "ai_identification", confidence: 0.5, fields: { color: "Bleu" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ source: "ebay", confidence: 0.9, fields: { color: "Blue" } }));

    expect(second.newConflicts).toEqual([]);
    expect(second.identity.fields.color?.value).toBe("Blue"); // confiance plus élevée l'emporte
    expect(second.identity.fields.color?.source).toBe("ebay");
  });

  it("champ doux avec une confiance plus faible ne remplace jamais la claim existante", () => {
    const identity = createCanonicalProductIdentity("apple");
    const first = mergeIdentityEvidence(identity, evidence({ source: "ebay", confidence: 0.9, fields: { color: "Blue" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ source: "ai_identification", confidence: 0.3, fields: { color: "Bleu" } }));

    expect(second.identity.fields.color?.value).toBe("Blue");
  });

  it("préserve les alias hors champs structurés, jamais forcés dans un champ existant", () => {
    const identity = createCanonicalProductIdentity("apple");
    const result = mergeIdentityEvidence(identity, evidence({ source: "google_shopping", aliases: [{ field: "googleProductId", value: "gp-123" }] }));

    expect(result.identity.aliases).toEqual([{ field: "googleProductId", value: "gp-123", source: "google_shopping", confidence: 0.8, observedAt: ASOF }]);
  });

  it("champ vide/blanc dans l'évidence -> jamais retenu comme une claim", () => {
    const identity = createCanonicalProductIdentity("apple");
    const result = mergeIdentityEvidence(identity, evidence({ fields: { brand: "   " } }));
    expect(result.identity.fields.brand).toBeUndefined();
  });

  it("les conflits s'accumulent dans identity.conflicts au fil des fusions successives", () => {
    const identity = createCanonicalProductIdentity("apple");
    const first = mergeIdentityEvidence(identity, evidence({ fields: { upc: "111" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ fields: { upc: "222" } }));
    const third = mergeIdentityEvidence(second.identity, evidence({ fields: { mpn: "abc" } }));
    const fourth = mergeIdentityEvidence(third.identity, evidence({ fields: { mpn: "xyz" } }));

    expect(fourth.identity.conflicts).toHaveLength(2);
  });
});

describe("resolveIdentityConflict", () => {
  it("résout explicitement un conflit et le retire de la liste", () => {
    const identity = createCanonicalProductIdentity("apple");
    const first = mergeIdentityEvidence(identity, evidence({ source: "ebay", fields: { upc: "111" } }));
    const second = mergeIdentityEvidence(first.identity, evidence({ source: "google_shopping", fields: { upc: "222" } }));
    expect(second.identity.conflicts).toHaveLength(1);

    const winningClaim = second.identity.conflicts[0]!.claims[1]!; // choisit la 2e affirmation (google_shopping)
    const resolved = resolveIdentityConflict(second.identity, "upc", winningClaim);

    expect(resolved.conflicts).toEqual([]);
    expect(resolved.fields.upc?.value).toBe("222");
  });

  it("ne touche jamais un autre conflit non ciblé", () => {
    const identity = createCanonicalProductIdentity("apple");
    const withUpcConflict = mergeIdentityEvidence(mergeIdentityEvidence(identity, evidence({ fields: { upc: "111" } })).identity, evidence({ fields: { upc: "222" } })).identity;
    const withBothConflicts = mergeIdentityEvidence(mergeIdentityEvidence(withUpcConflict, evidence({ fields: { mpn: "a" } })).identity, evidence({ fields: { mpn: "b" } })).identity;

    const resolved = resolveIdentityConflict(withBothConflicts, "upc", withBothConflicts.fields.upc!);
    expect(resolved.conflicts.map((c) => c.field)).toEqual(["mpn"]);
  });
});
