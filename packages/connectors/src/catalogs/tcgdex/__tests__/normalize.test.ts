import { describe, expect, it } from "vitest";
import { matchTcgdexCard, normalizeTcgdexCard, resolveTcgdexLanguage } from "../normalize";
import { PIKACHU_BASE1_EN, PIKACHU_BASE1_FR, FURRET_SWSH3_SHARED_PRODUCT_ID, CARD_WITHOUT_PRICING, PIKACHU_WRONG_SET_MATCH } from "./fixtures/cards";

describe("resolveTcgdexLanguage", () => {
  it("reconnaît le français sous plusieurs formes", () => {
    expect(resolveTcgdexLanguage("fr")).toBe("fr");
    expect(resolveTcgdexLanguage("French")).toBe("fr");
    expect(resolveTcgdexLanguage("français")).toBe("fr");
  });

  it("retombe sur l'anglais par défaut, jamais une devinette exotique", () => {
    expect(resolveTcgdexLanguage(undefined)).toBe("en");
    expect(resolveTcgdexLanguage("en")).toBe("en");
    expect(resolveTcgdexLanguage("German")).toBe("en");
  });
});

describe("normalizeTcgdexCard", () => {
  it("porte la langue interrogée dans canonicalAttributes, jamais devinée depuis la réponse", () => {
    const item = normalizeTcgdexCard(PIKACHU_BASE1_FR, "pokemon_tcg", "fr");
    expect(item.source).toBe("tcgdex");
    expect(item.externalId).toBe("base1-58");
    expect(item.canonicalAttributes.language).toBe("fr");
    expect(item.canonicalAttributes.setName).toBe("Set de Base");
    expect(item.images).toEqual(["https://assets.tcgdex.net/fr/base/base1/58"]);
  });

  // LOT "Free/Open Sources + Real Readiness + Live Smoke Tests", section 2
  // — `pricing` était analysé par le schéma Zod puis silencieusement jeté
  // (seulement présent dans `raw`, jamais exposé) avant ce lot.
  describe("agrégats de prix tiers (Cardmarket/TCGplayer) — jamais une vente confirmée", () => {
    it("Cardmarket : low/trend/avg -> priceLow/priceMid/priceHigh, devise = unit, jamais EUR codé en dur si le champ diffère", () => {
      const item = normalizeTcgdexCard(PIKACHU_BASE1_EN, "pokemon_tcg", "en");
      const cardmarketHint = item.priceHints?.find((h) => h.source === "cardmarket" && h.variant === null);
      expect(cardmarketHint).toEqual({
        source: "cardmarket",
        variant: null,
        priceLow: 0.05,
        priceMid: 6.57,
        priceHigh: 5.76,
        currency: "EUR",
        observedAt: "2026-08-01T08:03:04.467Z",
        provenance: "listing_aggregate",
      });
    });

    it("Cardmarket holo : avg-holo/low-holo null mais trend-holo renseigné -> variante 'holo' quand même ajoutée (jamais les 3 champs exigés ensemble)", () => {
      const item = normalizeTcgdexCard(PIKACHU_BASE1_EN, "pokemon_tcg", "en");
      const holoHint = item.priceHints?.find((h) => h.source === "cardmarket" && h.variant === "holo");
      expect(holoHint).toEqual({
        source: "cardmarket",
        variant: "holo",
        priceLow: null,
        priceMid: 36.37,
        priceHigh: null,
        currency: "EUR",
        observedAt: "2026-08-01T08:03:04.467Z",
        provenance: "listing_aggregate",
      });
    });

    it("Cardmarket holo entièrement renseigné (Furret) : les 3 champs holo transmis tels quels", () => {
      const item = normalizeTcgdexCard(FURRET_SWSH3_SHARED_PRODUCT_ID, "pokemon_tcg", "en");
      const holoHint = item.priceHints?.find((h) => h.source === "cardmarket" && h.variant === "holo");
      expect(holoHint).toMatchObject({ priceLow: 0.02, priceMid: 0.34, priceHigh: 0.29 });
    });

    it("TCGplayer : une entrée PAR VARIANTE réelle (normal/reverse-holofoil…), jamais 'updated'/'unit' traités comme une variante", () => {
      const item = normalizeTcgdexCard(FURRET_SWSH3_SHARED_PRODUCT_ID, "pokemon_tcg", "en");
      const tcgplayerHints = item.priceHints?.filter((h) => h.source === "tcgplayer") ?? [];
      expect(tcgplayerHints.map((h) => h.variant).sort()).toEqual(["normal", "reverse-holofoil"]);
      expect(tcgplayerHints.every((h) => h.currency === "USD")).toBe(true);
      const normalHint = tcgplayerHints.find((h) => h.variant === "normal");
      expect(normalHint).toMatchObject({ priceLow: 0.02, priceMid: 0.2, priceHigh: 25.17 });
    });

    it("carte sans aucune donnée de prix : priceHints vide, jamais une valeur inventée", () => {
      const item = normalizeTcgdexCard(CARD_WITHOUT_PRICING, "pokemon_tcg", "en");
      expect(item.priceHints).toEqual([]);
    });

    it("cardmarket partiel (un seul champ renseigné, ex. trend seul) : toujours exposé, les champs absents restent null", () => {
      const item = normalizeTcgdexCard(PIKACHU_WRONG_SET_MATCH, "pokemon_tcg", "en");
      const hint = item.priceHints?.find((h) => h.source === "cardmarket" && h.variant === null);
      expect(hint).toEqual({
        source: "cardmarket",
        variant: null,
        priceLow: null,
        priceMid: 2.0,
        priceHigh: null,
        currency: "EUR",
        observedAt: "2026-08-01T00:00:00Z",
        provenance: "listing_aggregate",
      });
    });
  });

  it("variantes réellement possédées (normal/reverse/holo/firstEdition) sérialisées en liste, jamais un enum figé", () => {
    const item = normalizeTcgdexCard(PIKACHU_BASE1_EN, "pokemon_tcg", "en");
    expect(item.canonicalAttributes.variants).toBe("normal,firstEdition");
  });

  it("illustrateur reporté tel quel quand présent, null sinon", () => {
    const withIllustrator = normalizeTcgdexCard(PIKACHU_BASE1_EN, "pokemon_tcg", "en");
    expect(withIllustrator.canonicalAttributes.illustrator).toBe("Mitsuhiro Arita");
    const withoutIllustrator = normalizeTcgdexCard(CARD_WITHOUT_PRICING, "pokemon_tcg", "en");
    expect(withoutIllustrator.canonicalAttributes.illustrator).toBeNull();
  });
});

describe("matchTcgdexCard", () => {
  it("carte anglaise exacte : set + numéro + langue corroborés, confiance maximale", () => {
    const match = matchTcgdexCard(PIKACHU_BASE1_EN, { name: "Pikachu", setName: "Base Set", setCode: "base1", collectorNumber: "58", language: "en" }, "en");
    expect(match.confidence).toBe(1);
    expect(match.matchedOn).toEqual(expect.arrayContaining(["name", "setName", "collectorNumber", "language"]));
  });

  it("carte française exacte : set + numéro + langue corroborés en locale fr", () => {
    const match = matchTcgdexCard(PIKACHU_BASE1_FR, { name: "Pikachu", setName: "Set de Base", setCode: "base1", collectorNumber: "58", language: "fr" }, "fr");
    expect(match.confidence).toBe(1);
    expect(match.matchedOn).toEqual(expect.arrayContaining(["name", "setName", "collectorNumber", "language"]));
  });

  it("set/numéro exacts sans langue précisée : toujours résolu, sans corroboration de langue", () => {
    const match = matchTcgdexCard(PIKACHU_BASE1_EN, { name: "Pikachu", setName: "Base Set", setCode: "base1", collectorNumber: "58" }, "en");
    expect(match.confidence).toBe(1);
    expect(match.matchedOn).not.toContain("language");
  });

  it("mauvaise langue : hints demandent le français, la carte résolue est en anglais — jamais une équivalence silencieuse", () => {
    const match = matchTcgdexCard(PIKACHU_BASE1_EN, { name: "Pikachu", setName: "Base Set", setCode: "base1", collectorNumber: "58", language: "fr" }, "en");
    expect(match.matchedOn).not.toContain("language");
    expect(match.confidence).toBeLessThan(1);
  });

  it("nom seul : jamais une confiance totale, plafonnée", () => {
    const match = matchTcgdexCard(PIKACHU_BASE1_EN, { name: "Pikachu" }, "en");
    expect(match.confidence).toBe(0.5);
    expect(match.matchedOn).toEqual(["name"]);
  });

  it("set nommé différemment par Pokémon TCG API (\"Base\") que par TCGdex (\"Base Set\") : corroboré, jamais une égalité brute (LOT 7C — démontré par test réel)", () => {
    // Avant ce correctif, une égalité brute sur `set.name` ne créditait
    // jamais "setName" ici quand les hints venaient du catalogue principal
    // (Pokémon TCG API, qui nomme ce set "Base") — désactivant silencieusement
    // le filtre de set côté pricing en aval (repli `single_catalog_source`)
    // et laissant passer de faux candidats d'autres sets.
    const match = matchTcgdexCard(PIKACHU_BASE1_EN, { name: "Pikachu", setName: "Base", setCode: "base1", collectorNumber: "58", language: "en" }, "en");
    expect(match.matchedOn).toContain("setName");
    expect(match.confidence).toBe(1);
  });
});
