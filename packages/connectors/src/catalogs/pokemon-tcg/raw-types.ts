import { z } from "zod";

/**
 * Schéma Zod du sous-ensemble de la réponse Pokémon TCG API (`GET /v2/cards`)
 * que nous consommons réellement — champs confirmés par des appels réels à
 * `api.pokemontcg.io/v2/cards` (pas une supposition sur la documentation).
 * Tout ce qui n'est pas nécessaire à l'identification (attacks, weaknesses,
 * legalities, flavorText…) est délibérément omis, pas juste ignoré : `.strip()`
 * (comportement par défaut de Zod) laisse passer les champs inconnus sans les
 * valider ni les exposer.
 */

const priceTierSchema = z.object({
  low: z.number().nullable().optional(),
  mid: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  market: z.number().nullable().optional(),
  directLow: z.number().nullable().optional(),
});

/** Clés dynamiques par variante (ex. "holofoil", "1stEditionHolofoil", "reverseHolofoil") — jamais un enum figé. */
const tcgplayerSchema = z
  .object({
    url: z.string().optional(),
    updatedAt: z.string().optional(),
    prices: z.record(z.string(), priceTierSchema).optional(),
  })
  .optional();

/** Cardmarket n'a pas de ventilation par variante : un seul jeu de prix agrégés, champs parfois `0`/`null`. */
const cardmarketSchema = z
  .object({
    url: z.string().optional(),
    updatedAt: z.string().optional(),
    prices: z
      .object({
        averageSellPrice: z.number().nullable().optional(),
        lowPrice: z.number().nullable().optional(),
        trendPrice: z.number().nullable().optional(),
      })
      .catchall(z.number().nullable())
      .optional(),
  })
  .optional();

const rawSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  series: z.string().optional(),
  releaseDate: z.string().optional(),
  images: z.object({ symbol: z.string().optional(), logo: z.string().optional() }).optional(),
});

const rawImagesSchema = z.object({
  small: z.string().optional(),
  large: z.string().optional(),
});

export const pokemonTcgRawCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  supertype: z.string().optional(),
  subtypes: z.array(z.string()).optional(),
  number: z.string(),
  rarity: z.string().optional(),
  set: rawSetSchema,
  images: rawImagesSchema.optional(),
  tcgplayer: tcgplayerSchema,
  cardmarket: cardmarketSchema,
});
export type PokemonTcgRawCard = z.infer<typeof pokemonTcgRawCardSchema>;

export const pokemonTcgSearchResponseSchema = z.object({
  data: z.array(pokemonTcgRawCardSchema),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  count: z.number().optional(),
  totalCount: z.number().optional(),
});
export type PokemonTcgSearchResponse = z.infer<typeof pokemonTcgSearchResponseSchema>;

export const pokemonTcgGetCardResponseSchema = z.object({
  data: pokemonTcgRawCardSchema,
});
