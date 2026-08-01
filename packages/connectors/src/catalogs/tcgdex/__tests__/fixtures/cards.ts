/**
 * Fixtures — échantillons réels capturés depuis `api.tcgdex.net/v2/{en,fr}`
 * (`cards/base1-58` et `cards/swsh3-136`), champs non pertinents à
 * l'identification/pricing omis. Jamais de données inventées.
 */
import type { TcgdexCard } from "../../raw-types";

export const PIKACHU_BASE1_EN: TcgdexCard = {
  category: "Pokemon",
  id: "base1-58",
  illustrator: "Mitsuhiro Arita",
  image: "https://assets.tcgdex.net/en/base/base1/58",
  localId: "58",
  name: "Pikachu",
  rarity: "Common",
  set: { id: "base1", name: "Base Set", cardCount: { official: 102, total: 102 } },
  variants: { normal: true, reverse: false, holo: false, firstEdition: true },
  updated: "2026-07-11T09:49:03+01:00",
  pricing: {
    cardmarket: {
      updated: "2026-08-01T08:03:04.467Z",
      unit: "EUR",
      idProduct: 273753,
      avg: 5.76,
      low: 0.05,
      trend: 6.57,
      "avg-holo": null,
      "low-holo": null,
      "trend-holo": 36.37,
    },
    tcgplayer: {
      updated: "2026-08-01T08:03:01.297Z",
      unit: "USD",
      normal: { productId: 42402, lowPrice: 1.4, midPrice: 4, highPrice: 1000, marketPrice: 7.68, directLowPrice: 4.97 },
    },
  },
};

export const PIKACHU_BASE1_FR: TcgdexCard = {
  category: "Pokémon",
  id: "base1-58",
  illustrator: "Mitsuhiro Arita",
  image: "https://assets.tcgdex.net/fr/base/base1/58",
  localId: "58",
  name: "Pikachu",
  rarity: "Commune",
  set: { id: "base1", name: "Set de Base", cardCount: { official: 102, total: 102 } },
  variants: { normal: true, reverse: false, holo: false, firstEdition: true },
  updated: "2026-07-11T09:49:03+01:00",
  pricing: {
    cardmarket: {
      updated: "2026-08-01T08:03:04.467Z",
      unit: "EUR",
      idProduct: 273753,
      avg: 5.76,
      low: 0.05,
      trend: 6.57,
      "avg-holo": null,
      "low-holo": null,
      "trend-holo": 36.37,
    },
    tcgplayer: {
      updated: "2026-08-01T08:03:01.297Z",
      unit: "USD",
      normal: { productId: 42402, lowPrice: 1.4, midPrice: 4, highPrice: 1000, marketPrice: 7.68, directLowPrice: 4.97 },
    },
  },
};

/** Furret (swsh3-136) — `normal` et `reverse-holofoil` partagent le même `productId` côté TCGPlayer (observé en direct). */
export const FURRET_SWSH3_SHARED_PRODUCT_ID: TcgdexCard = {
  category: "Pokemon",
  id: "swsh3-136",
  illustrator: "tetsuya koizumi",
  image: "https://assets.tcgdex.net/en/swsh/swsh3/136",
  localId: "136",
  name: "Furret",
  rarity: "Uncommon",
  set: { id: "swsh3", name: "Darkness Ablaze", cardCount: { official: 189, total: 201 } },
  variants: { normal: false, reverse: true, holo: false, firstEdition: false },
  updated: "2024-02-04T22:55:32+02:00",
  pricing: {
    cardmarket: {
      updated: "2026-08-01T08:03:04.467Z",
      unit: "EUR",
      avg: 0.11,
      low: 0.02,
      trend: 0.15,
      "avg-holo": 0.29,
      "low-holo": 0.02,
      "trend-holo": 0.34,
    },
    tcgplayer: {
      updated: "2026-08-01T08:03:02.811Z",
      unit: "USD",
      normal: { productId: 219333, lowPrice: 0.02, midPrice: 0.2, highPrice: 25.17, marketPrice: 0.17, directLowPrice: 0.05 },
      "reverse-holofoil": { productId: 219333, lowPrice: 0.17, midPrice: 0.37, highPrice: 19.98, marketPrice: 0.37, directLowPrice: 0.43 },
    },
  },
};

/** Carte sans aucune donnée de prix — pour vérifier qu'aucune valeur n'est inventée. */
export const CARD_WITHOUT_PRICING: TcgdexCard = {
  category: "Pokemon",
  id: "xyp-XY99",
  image: "https://assets.tcgdex.net/en/xy/xyp/XY99",
  localId: "XY99",
  name: "Aerodactyl Spirit Link",
  set: { id: "xyp", name: "XY Promos" },
  variants: { normal: true, reverse: false, holo: false, firstEdition: false },
  updated: "2020-01-01T00:00:00Z",
};

/** Même carte que POKEMON_PIKACHU (LOT 1) sous un id de set TCGdex différent — pour la divergence Pokémon TCG API ↔ TCGdex. */
export const PIKACHU_WRONG_SET_MATCH: TcgdexCard = {
  category: "Pokemon",
  id: "jungle-1",
  localId: "1",
  name: "Pikachu",
  set: { id: "base2", name: "Jungle" },
  variants: { normal: true, reverse: false, holo: false, firstEdition: false },
  updated: "2020-01-01T00:00:00Z",
  pricing: {
    cardmarket: { updated: "2026-08-01T00:00:00Z", unit: "EUR", trend: 2.0 },
  },
};
