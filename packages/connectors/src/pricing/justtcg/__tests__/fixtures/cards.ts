/**
 * Fixtures — construites pour correspondre exactement au schéma confirmé
 * (code source officiel `justtcg/justtcg-js`, `src/types/v2.ts`), pas
 * capturées en direct : JustTCG exige une clé API que nous n'avons pas
 * encore (voir rapport du LOT 2). Aucune valeur de prix n'est réelle.
 */
import type { JustTcgRawCard } from "../../raw-types";

export const PIKACHU_RAW_CARD: JustTcgRawCard = {
  id: "card_pikachu_base4",
  name: "Pikachu",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "base4", name: "Base Set" },
  number: "58",
  rarity: "Common",
  variants: [
    {
      id: "variant_pikachu_base4_nm",
      type: "raw",
      condition: "Near Mint",
      printing: "Normal",
      language: "English",
      markets: [{ region: "US", currency: "USD", price: 3.5, updated_at: 1785500000 }],
    },
    {
      id: "variant_pikachu_base4_lp",
      type: "raw",
      condition: "Lightly Played",
      printing: "Normal",
      language: "English",
      markets: [{ region: "US", currency: "USD", price: 2.1, updated_at: 1785500000 }],
    },
  ],
};

export const CHARIZARD_GRADED_CARD: JustTcgRawCard = {
  id: "card_charizard_base4",
  name: "Charizard",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "base4", name: "Base Set" },
  number: "4",
  rarity: "Rare Holo",
  variants: [
    {
      id: "variant_charizard_base4_psa10",
      type: "graded",
      condition: null,
      printing: "Holofoil",
      grading: { company: "PSA", grade: 10, grade_label: null, qualifier: null, canonical: "PSA 10" },
      markets: [{ region: "US", currency: "USD", price: 12000, updated_at: 1785500000 }],
    },
    {
      id: "variant_charizard_base4_psa9",
      type: "graded",
      condition: null,
      printing: "Holofoil",
      grading: { company: "PSA", grade: 9, grade_label: null, qualifier: null, canonical: "PSA 9" },
      markets: [{ region: "US", currency: "USD", price: 3200, updated_at: 1785500000 }],
    },
    {
      id: "variant_charizard_base4_raw_nm",
      type: "raw",
      condition: "Near Mint",
      printing: "Holofoil",
      markets: [{ region: "US", currency: "USD", price: 450, updated_at: 1785500000 }],
    },
  ],
};

/** Deux cartes homonymes de sets différents — pour le test "nom seul ambigu". */
export const AMBIGUOUS_NAME_CARDS: JustTcgRawCard[] = [
  {
    id: "card_charizard_base4",
    name: "Charizard",
    game: { id: "pokemon", name: "Pokémon" },
    set: { id: "base4", name: "Base Set" },
    number: "4",
    variants: [
      { id: "v1", type: "raw", condition: "Near Mint", printing: "Holofoil", markets: [{ region: "US", currency: "USD", price: 450 }] },
    ],
  },
  {
    id: "card_charizard_swsh12",
    name: "Charizard",
    game: { id: "pokemon", name: "Pokémon" },
    set: { id: "swsh12", name: "Silver Tempest" },
    number: "20",
    variants: [
      { id: "v2", type: "raw", condition: "Near Mint", printing: "Holofoil", markets: [{ region: "US", currency: "USD", price: 8.5 }] },
    ],
  },
];

/** Carte réelle sans aucune donnée de prix locale (`price: null`) — pour vérifier qu'aucune valeur n'est inventée. */
export const CARD_WITHOUT_PRICE: JustTcgRawCard = {
  id: "card_no_price",
  name: "Rare Regional Promo",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "promo", name: "Promo" },
  number: "999",
  variants: [{ id: "variant_no_price", type: "raw", condition: "Near Mint", printing: "Normal", markets: [{ region: "US", currency: "USD", price: null }] }],
};
