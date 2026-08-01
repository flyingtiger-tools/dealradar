import { describe, expect, it } from "vitest";
import { matchTcgdexCard, normalizeTcgdexCard, resolveTcgdexLanguage } from "../normalize";
import { PIKACHU_BASE1_EN, PIKACHU_BASE1_FR } from "./fixtures/cards";

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
