import { z } from "zod";

/**
 * Schéma Zod du sous-ensemble de l'API TCGdex (`GET /v2/{lang}/cards/{id}`,
 * `GET /v2/{lang}/cards`) que nous consommons réellement — champs confirmés
 * par des appels réels à `api.tcgdex.net` (locales `en` et `fr`), pas une
 * supposition sur la documentation. `category`/`rarity`/`set.name` sont
 * localisés selon la langue interrogée (ex. "Common" en `en`, "Commune" en
 * `fr`) ; `id`/`localId` restent stables quelle que soit la langue.
 */

const tcgplayerVariantPriceSchema = z.object({
  productId: z.number().optional(),
  lowPrice: z.number().nullable().optional(),
  midPrice: z.number().nullable().optional(),
  highPrice: z.number().nullable().optional(),
  marketPrice: z.number().nullable().optional(),
  directLowPrice: z.number().nullable().optional(),
});

/**
 * Clés dynamiques par variante ("normal", "reverse-holofoil", "1st-edition"…)
 * mêlées à `updated`/`unit` dans le même objet (forme confirmée par appel
 * réel) — jamais un enum de variantes figé. Un `record` plutôt qu'un objet
 * + `.catchall` : Zod exige sinon que les propriétés explicites (`updated`,
 * `unit`) soient elles-mêmes compatibles avec le type des clés dynamiques,
 * ce qu'elles ne sont pas ici. Le tri variante/métadonnée se fait à la
 * lecture (voir `normalize.ts`), pas dans le schéma.
 */
const tcgplayerPricingSchema = z
  .record(z.string(), z.union([z.string(), z.number(), tcgplayerVariantPriceSchema]))
  .nullable()
  .optional();

const cardmarketPricingSchema = z
  .object({
    updated: z.union([z.string(), z.number()]).optional(),
    unit: z.string().optional(),
    idProduct: z.number().optional(),
    avg: z.number().nullable().optional(),
    low: z.number().nullable().optional(),
    trend: z.number().nullable().optional(),
    avg1: z.number().nullable().optional(),
    avg7: z.number().nullable().optional(),
    avg30: z.number().nullable().optional(),
    "avg-holo": z.number().nullable().optional(),
    "low-holo": z.number().nullable().optional(),
    "trend-holo": z.number().nullable().optional(),
    "avg1-holo": z.number().nullable().optional(),
    "avg7-holo": z.number().nullable().optional(),
    "avg30-holo": z.number().nullable().optional(),
  })
  .nullable()
  .optional();

const tcgdexSetBriefSchema = z.object({
  id: z.string(),
  name: z.string(),
  cardCount: z.object({ official: z.number().optional(), total: z.number().optional() }).optional(),
  logo: z.string().optional(),
  symbol: z.string().optional(),
});

const tcgdexVariantsSchema = z.object({
  normal: z.boolean().optional(),
  reverse: z.boolean().optional(),
  holo: z.boolean().optional(),
  firstEdition: z.boolean().optional(),
  wPromo: z.boolean().optional(),
});

export const tcgdexCardSchema = z.object({
  id: z.string(),
  localId: z.union([z.string(), z.number()]),
  name: z.string(),
  category: z.string(),
  image: z.string().optional(),
  illustrator: z.string().optional(),
  rarity: z.string().optional(),
  set: tcgdexSetBriefSchema,
  variants: tcgdexVariantsSchema.optional(),
  updated: z.string().optional(),
  pricing: z
    .object({
      cardmarket: cardmarketPricingSchema,
      tcgplayer: tcgplayerPricingSchema,
    })
    .optional(),
});
export type TcgdexCard = z.infer<typeof tcgdexCardSchema>;

export const tcgdexCardBriefSchema = z.object({
  id: z.string(),
  localId: z.union([z.string(), z.number()]),
  name: z.string(),
  image: z.string().optional(),
});
export const tcgdexCardListSchema = z.array(tcgdexCardBriefSchema);
export type TcgdexCardBrief = z.infer<typeof tcgdexCardBriefSchema>;

export const tcgdexErrorSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().optional(),
  endpoint: z.string().optional(),
  method: z.string().optional(),
});
