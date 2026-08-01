/**
 * Fixtures alignées Pokémon TCG API ↔ JustTCG — les deux côtés décrivent
 * délibérément la même carte réelle (Pikachu Base Set #58, Charizard Base
 * Set #4) pour que les tests croisés exercent les vraies fonctions
 * `matchCard` (LOT 1) et `normalizeJustTcgCard` (LOT 2), pas des objets
 * reconstruits à la main. Construites pour correspondre au schéma confirmé
 * de chaque API (voir les rapports LOT 1/LOT 2) — pas des données réelles
 * capturées en direct.
 */
import type { PokemonTcgRawCard } from "../../../catalogs/pokemon-tcg/raw-types";
import type { JustTcgRawCard } from "../../../pricing/justtcg/raw-types";

export const POKEMON_PIKACHU: PokemonTcgRawCard = {
  id: "base4-58",
  name: "Pikachu",
  supertype: "Pokémon",
  number: "58",
  rarity: "Common",
  set: { id: "base4", name: "Base Set" },
  images: { small: "https://images.pokemontcg.io/base4/58.png", large: "https://images.pokemontcg.io/base4/58_hires.png" },
};

export const POKEMON_CHARIZARD: PokemonTcgRawCard = {
  id: "base4-4",
  name: "Charizard",
  supertype: "Pokémon",
  number: "4",
  rarity: "Rare Holo",
  set: { id: "base4", name: "Base Set" },
  images: { small: "https://images.pokemontcg.io/base4/4.png", large: "https://images.pokemontcg.io/base4/4_hires.png" },
};

/** Trois variantes brutes du même Pikachu — pour distinguer normal/holo/reverse sans jamais les confondre. */
export const JUSTTCG_PIKACHU_MULTI_VARIANT: JustTcgRawCard = {
  id: "jt_pikachu_base4",
  name: "Pikachu",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "base4", name: "Base Set" },
  number: "58",
  variants: [
    { id: "v_normal", type: "raw", condition: "Near Mint", printing: "Normal", language: "English", markets: [{ region: "US", currency: "USD", price: 1.5 }] },
    { id: "v_holo", type: "raw", condition: "Near Mint", printing: "Holofoil", language: "English", markets: [{ region: "US", currency: "USD", price: 5.0 }] },
    { id: "v_reverse", type: "raw", condition: "Near Mint", printing: "Reverse Holofoil", language: "English", markets: [{ region: "US", currency: "USD", price: 8.0 }] },
    { id: "v_no_lang", type: "raw", condition: "Near Mint", printing: "Unlimited", markets: [{ region: "US", currency: "USD", price: 1.2 }] },
    { id: "v_japanese", type: "raw", condition: "Near Mint", printing: "Normal", language: "Japanese", markets: [{ region: "US", currency: "USD", price: 0.9 }] },
    { id: "v_no_price", type: "raw", condition: "Damaged", printing: "Normal", language: "English", markets: [{ region: "US", currency: "USD", price: null }] },
  ],
};

/** Numéro au format réel JustTCG ("058/102", zéro de tête + dénominateur) — pour la corroboration cross-source de `number`. */
export const JUSTTCG_PIKACHU_PADDED_NUMBER: JustTcgRawCard = {
  id: "jt_pikachu_base4_padded",
  name: "Pikachu",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "base-set-pokemon", name: "Base Set" },
  number: "058/102",
  variants: [
    { id: "v_normal_padded", type: "raw", condition: "Near Mint", printing: "Normal", language: "English", markets: [{ region: "US", currency: "USD", price: 7.68 }] },
  ],
};

export const JUSTTCG_CHARIZARD_GRADED: JustTcgRawCard = {
  id: "jt_charizard_base4",
  name: "Charizard",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "base4", name: "Base Set" },
  number: "4",
  variants: [
    { id: "v_psa10", type: "graded", grading: { company: "PSA", grade: 10, grade_label: null, qualifier: null, canonical: "PSA 10" }, markets: [{ region: "US", currency: "USD", price: 12000 }] },
    { id: "v_psa9", type: "graded", grading: { company: "PSA", grade: 9, grade_label: null, qualifier: null, canonical: "PSA 9" }, markets: [{ region: "US", currency: "USD", price: 3200 }] },
    { id: "v_bgs10", type: "graded", grading: { company: "BGS", grade: 10, grade_label: null, qualifier: null, canonical: "BGS 10" }, markets: [{ region: "US", currency: "USD", price: 15000 }] },
    { id: "v_raw_holo", type: "raw", condition: "Near Mint", printing: "Holofoil", language: "English", markets: [{ region: "US", currency: "USD", price: 450 }] },
  ],
};

/** Même nom, set différent — pour "mauvais set" (le catalogue attend Base Set). */
export const JUSTTCG_PIKACHU_WRONG_SET: JustTcgRawCard = {
  id: "jt_pikachu_jungle",
  name: "Pikachu",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "jungle", name: "Jungle" },
  number: "60",
  variants: [{ id: "v1", type: "raw", condition: "Near Mint", printing: "Normal", language: "English", markets: [{ region: "US", currency: "USD", price: 2.0 }] }],
};

/** Même nom et set, numéro différent — pour "mauvais numéro". */
export const JUSTTCG_PIKACHU_WRONG_NUMBER: JustTcgRawCard = {
  id: "jt_pikachu_base4_wrongnum",
  name: "Pikachu",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "base4", name: "Base Set" },
  number: "99",
  variants: [{ id: "v1", type: "raw", condition: "Near Mint", printing: "Normal", language: "English", markets: [{ region: "US", currency: "USD", price: 2.0 }] }],
};

/** Set/numéro/variante corrects, mais aucun prix local (`price: null`) — pour "absence de prix". */
export const JUSTTCG_PIKACHU_NO_PRICE: JustTcgRawCard = {
  id: "jt_pikachu_base4_noprice",
  name: "Pikachu",
  game: { id: "pokemon", name: "Pokémon" },
  set: { id: "base4", name: "Base Set" },
  number: "58",
  variants: [
    { id: "v_noprice", type: "raw", condition: "Near Mint", printing: "Normal", language: "English", markets: [{ region: "US", currency: "USD", price: null }] },
  ],
};
