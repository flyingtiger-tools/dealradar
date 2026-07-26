import { describe, expect, it } from "vitest";
import { identifyListing } from "../identify";
import type { NormalizedListing } from "../types";

function listing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: "l1",
    sourceSlug: "test",
    title: "LEGO Star Wars 75192",
    priceCents: 60000,
    currency: "CHF",
    condition: "good",
    categorySlug: "lego",
    attributes: { setNumber: "75192", piecesCount: 7541, hasBox: true, complete: true },
    ...overrides,
  };
}

describe("identifyListing", () => {
  it("résout le profil et ne signale aucun champ manquant sur une annonce complète", () => {
    const identity = identifyListing(listing());
    expect(identity.profile?.slug).toBe("lego");
    expect(identity.missingRequiredFields).toEqual([]);
    expect(identity.matchedRiskSignals).toEqual([]);
  });

  it("signale les champs obligatoires manquants", () => {
    const identity = identifyListing(listing({ attributes: { hasBox: true } }));
    expect(identity.missingRequiredFields).toEqual(["setNumber", "piecesCount"]);
  });

  it("signale un champ manquant qui n'affecte pas la similarité (piecesCount)", () => {
    const identity = identifyListing(listing({ attributes: { setNumber: "75192" } }));
    expect(identity.missingRequiredFields).toEqual(["piecesCount"]);
  });

  it("déclenche les signaux de risque du profil", () => {
    const identity = identifyListing(
      listing({ attributes: { setNumber: "75192", piecesCount: 7541, hasBox: false, complete: true } }),
    );
    expect(identity.matchedRiskSignals.map((s) => s.id)).toEqual(["missing_box"]);
  });

  it("ne résout aucun profil pour une catégorie inconnue, sans planter", () => {
    const identity = identifyListing(listing({ categorySlug: "meubles_jardin", attributes: {} }));
    expect(identity.profile).toBeNull();
    expect(identity.missingRequiredFields).toEqual([]);
    expect(identity.matchedRiskSignals).toEqual([]);
  });
});
