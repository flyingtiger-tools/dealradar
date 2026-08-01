import { describe, expect, it } from "vitest";
import { normalizeTcgdexPricing } from "../normalize";
import { CARD_WITHOUT_PRICING, FURRET_SWSH3_SHARED_PRODUCT_ID, PIKACHU_BASE1_EN } from "../../../catalogs/tcgdex/__tests__/fixtures/cards";

describe("normalizeTcgdexPricing", () => {
  it("prix Cardmarket EUR présent : observation distincte, devise EUR, avertissement marché suisse", () => {
    const observations = normalizeTcgdexPricing(PIKACHU_BASE1_EN, { name: "Pikachu" }, "en");
    const cardmarket = observations.find((o) => o.provenance === "tcgdex-cardmarket");

    expect(cardmarket).toBeDefined();
    expect(cardmarket!.currency).toBe("EUR");
    expect(cardmarket!.amountCents).toBe(657); // trend = 6.57 EUR
    expect(cardmarket!.region).toBe("EU");
    expect(cardmarket!.warnings.some((w) => w.toLowerCase().includes("suisse"))).toBe(true);
  });

  it("prix TCGplayer USD présent : observation distincte, devise USD, jamais moyennée avec Cardmarket", () => {
    const observations = normalizeTcgdexPricing(PIKACHU_BASE1_EN, { name: "Pikachu" }, "en");
    const tcgplayer = observations.find((o) => o.provenance === "tcgdex-tcgplayer");

    expect(tcgplayer).toBeDefined();
    expect(tcgplayer!.currency).toBe("USD");
    expect(tcgplayer!.amountCents).toBe(768); // marketPrice = 7.68 USD
    expect(tcgplayer!.region).toBe("US");

    // Les observations restent séparées, jamais fusionnées/moyennées (ici :
    // Cardmarket normal + holo, TCGPlayer normal — la fixture porte les deux
    // jeux de prix Cardmarket réellement renvoyés par l'API).
    const cardmarket = observations.find((o) => o.provenance === "tcgdex-cardmarket");
    expect(cardmarket!.amountCents).not.toBe(tcgplayer!.amountCents);
    expect(observations).toHaveLength(3);
  });

  it("prix absent : aucune observation inventée", () => {
    const observations = normalizeTcgdexPricing(CARD_WITHOUT_PRICING, { name: "Aerodactyl Spirit Link" }, "en");
    expect(observations).toEqual([]);
  });

  it("mauvaise variante : filtre côté TCGPlayer, aucune observation si la variante demandée n'existe pas", () => {
    const observations = normalizeTcgdexPricing(PIKACHU_BASE1_EN, { name: "Pikachu", extra: { variant: "1st-edition-holofoil" } }, "en");
    const tcgplayer = observations.filter((o) => o.provenance === "tcgdex-tcgplayer");
    expect(tcgplayer).toHaveLength(0);
  });

  it("problème connu de mapping : deux variantes TCGPlayer partageant le même productId portent un avertissement explicite", () => {
    const observations = normalizeTcgdexPricing(FURRET_SWSH3_SHARED_PRODUCT_ID, { name: "Furret" }, "en");
    const tcgplayer = observations.filter((o) => o.provenance === "tcgdex-tcgplayer");

    expect(tcgplayer).toHaveLength(2);
    for (const obs of tcgplayer) {
      expect(obs.warnings.some((w) => w.includes("productId") || w.toLowerCase().includes("partagé"))).toBe(true);
    }
  });

  it("langue portée sur chaque observation, jamais devinée depuis le prix lui-même", () => {
    const observations = normalizeTcgdexPricing(PIKACHU_BASE1_EN, { name: "Pikachu" }, "fr");
    expect(observations.every((o) => o.language === "fr")).toBe(true);
  });
});
