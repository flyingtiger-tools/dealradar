/**
 * Fixtures — échantillons réels capturés depuis `api.pokemontcg.io/v2/cards`
 * (recherches "pikachu" et "charizard"), champs non pertinents à
 * l'identification omis. Jamais de données inventées : voir le rapport du
 * LOT 1 pour la provenance exacte.
 */
import type { PokemonTcgRawCard } from "../../raw-types";

export const PIKACHU_PROMO_CARD: PokemonTcgRawCard = {
  id: "basep-1",
  name: "Pikachu",
  supertype: "Pokémon",
  subtypes: ["Basic"],
  number: "1",
  rarity: "Promo",
  set: {
    id: "basep",
    name: "Wizards Black Star Promos",
    series: "Base",
    releaseDate: "1999/07/01",
    images: { symbol: "https://images.pokemontcg.io/basep/symbol.png", logo: "https://images.pokemontcg.io/basep/logo.png" },
  },
  images: { small: "https://images.pokemontcg.io/basep/1.png", large: "https://images.pokemontcg.io/basep/1_hires.png" },
  tcgplayer: { url: "https://prices.pokemontcg.io/tcgplayer/basep-1", updatedAt: "2023/03/27" },
  cardmarket: {
    url: "https://prices.pokemontcg.io/cardmarket/basep-1",
    updatedAt: "2026/07/01",
    prices: { averageSellPrice: 20.3, lowPrice: 7.47, trendPrice: 18.44 },
  },
};

export const CHARIZARD_GYM2_CARD: PokemonTcgRawCard = {
  id: "gym2-2",
  name: "Blaine's Charizard",
  supertype: "Pokémon",
  subtypes: ["Stage 2"],
  number: "2",
  rarity: "Rare Holo",
  set: {
    id: "gym2",
    name: "Gym Challenge",
    series: "Gym",
    releaseDate: "2000/10/16",
    images: { symbol: "https://images.pokemontcg.io/gym2/symbol.png", logo: "https://images.pokemontcg.io/gym2/logo.png" },
  },
  images: { small: "https://images.pokemontcg.io/gym2/2.png", large: "https://images.pokemontcg.io/gym2/2_hires.png" },
  tcgplayer: {
    url: "https://prices.pokemontcg.io/tcgplayer/gym2-2",
    updatedAt: "2026/08/01",
    prices: {
      "1stEditionHolofoil": { low: 696.69, mid: 2000.0, high: 2099.99, market: 699.99, directLow: null },
      unlimitedHolofoil: { low: 437.99, mid: 734.12, high: 1499.99, market: 594.19, directLow: 999.99 },
    },
  },
  cardmarket: {
    url: "https://prices.pokemontcg.io/cardmarket/gym2-2",
    updatedAt: "2026/07/01",
    prices: { averageSellPrice: 643.27, lowPrice: 70.0, trendPrice: 630.65 },
  },
};

/** Carte réelle sans aucun prix tiers (ni tcgplayer, ni cardmarket) — pour vérifier qu'aucun prix n'est inventé. */
export const CARD_WITHOUT_PRICES: PokemonTcgRawCard = {
  id: "swsh1-1",
  name: "Celebi",
  supertype: "Pokémon",
  number: "1",
  set: { id: "swsh1", name: "Sword & Shield", series: "Sword & Shield" },
  images: { small: "https://images.pokemontcg.io/swsh1/1.png", large: "https://images.pokemontcg.io/swsh1/1_hires.png" },
};
