import { describe, expect, it } from "vitest";
import { normalizePokemonTcgCard, matchCard } from "../normalize";
import { PIKACHU_PROMO_CARD, CHARIZARD_GYM2_CARD, CARD_WITHOUT_PRICES } from "./fixtures/cards";

describe("normalizePokemonTcgCard", () => {
  it("mappe une carte réelle vers CatalogItem sans rien inventer", () => {
    const item = normalizePokemonTcgCard(PIKACHU_PROMO_CARD, "pokemon_tcg");
    expect(item.source).toBe("pokemon-tcg-api");
    expect(item.externalId).toBe("basep-1");
    expect(item.kind).toBe("raw_card");
    expect(item.categorySlug).toBe("pokemon_tcg");
    expect(item.name).toBe("Pikachu");
    expect(item.canonicalAttributes.setId).toBe("basep");
    expect(item.canonicalAttributes.setName).toBe("Wizards Black Star Promos");
    expect(item.canonicalAttributes.collectorNumber).toBe("1");
    expect(item.canonicalAttributes.rarity).toBe("Promo");
    expect(item.images).toEqual([
      "https://images.pokemontcg.io/basep/1_hires.png",
      "https://images.pokemontcg.io/basep/1.png",
    ]);
  });

  it("extrait les prix TCGPlayer comme métadonnées avec provenance explicite, jamais une vente", () => {
    const item = normalizePokemonTcgCard(CHARIZARD_GYM2_CARD, "pokemon_tcg");
    const tcgplayerHints = item.priceHints?.filter((h) => h.source === "tcgplayer") ?? [];
    expect(tcgplayerHints).toHaveLength(2);
    expect(tcgplayerHints.every((h) => h.provenance === "listing_aggregate")).toBe(true);
    expect(tcgplayerHints.map((h) => h.variant).sort()).toEqual(["1stEditionHolofoil", "unlimitedHolofoil"]);
    const holo = tcgplayerHints.find((h) => h.variant === "unlimitedHolofoil");
    expect(holo?.priceLow).toBe(437.99);
    expect(holo?.priceMid).toBe(734.12);
  });

  it("extrait le prix Cardmarket agrégé (une seule entrée, pas de variante)", () => {
    const item = normalizePokemonTcgCard(CHARIZARD_GYM2_CARD, "pokemon_tcg");
    const cardmarketHints = item.priceHints?.filter((h) => h.source === "cardmarket") ?? [];
    expect(cardmarketHints).toHaveLength(1);
    expect(cardmarketHints[0]!.variant).toBeNull();
    expect(cardmarketHints[0]!.currency).toBe("EUR");
  });

  it("liste les variantes disponibles dans canonicalAttributes.variants", () => {
    const item = normalizePokemonTcgCard(CHARIZARD_GYM2_CARD, "pokemon_tcg");
    expect(item.canonicalAttributes.variants).toBe("1stEditionHolofoil,unlimitedHolofoil");
  });

  it("ne fabrique aucun prix pour une carte réelle sans tcgplayer ni cardmarket", () => {
    const item = normalizePokemonTcgCard(CARD_WITHOUT_PRICES, "pokemon_tcg");
    expect(item.priceHints).toEqual([]);
    expect(item.canonicalAttributes.variants).toBeNull();
  });
});

describe("matchCard", () => {
  it("confiance maximale quand tous les indices fournis correspondent", () => {
    const match = matchCard(CHARIZARD_GYM2_CARD, {
      name: "Blaine's Charizard",
      setName: "Gym Challenge",
      collectorNumber: "2",
    });
    expect(match.confidence).toBe(1);
    expect(match.matchedOn.sort()).toEqual(["collectorNumber", "name", "setName"]);
  });

  it("confiance partielle quand un indice fourni ne correspond pas", () => {
    const match = matchCard(CHARIZARD_GYM2_CARD, { name: "Blaine's Charizard", collectorNumber: "999" });
    expect(match.confidence).toBe(0.5);
    expect(match.matchedOn).toEqual(["name"]);
  });

  it("confiance modérée par construction quand seul le nom est fourni (déjà utilisé pour la recherche)", () => {
    const match = matchCard(PIKACHU_PROMO_CARD, { name: "Pikachu" });
    expect(match.confidence).toBe(0.5);
  });

  it("comparaison insensible à la casse/espaces superflus", () => {
    const match = matchCard(PIKACHU_PROMO_CARD, { name: "  PIKACHU  " });
    expect(match.matchedOn).toContain("name");
  });
});
