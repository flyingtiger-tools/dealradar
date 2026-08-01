import { z } from "zod";

/**
 * Schéma Zod du sous-ensemble de la réponse JustTCG `/v2/cards` que nous
 * consommons — champs confirmés via le code source officiel du SDK
 * (`justtcg/justtcg-js`, `src/types/v2.ts`), pas une supposition sur la doc.
 * V2 a une règle de nullabilité particulière ("absent ≠ null") : un champ non
 * demandé est omis, donc tout est `.optional()` sauf `price` qui est
 * explicitement `nullable()` (absence réelle de donnée locale).
 */

const gradingSchema = z.object({
  company: z.string(),
  grade: z.number().nullable(),
  grade_label: z.string().nullable().optional(),
  qualifier: z.string().nullable().optional(),
  canonical: z.string(),
});

const marketSchema = z.object({
  region: z.string(),
  currency: z.string(),
  price: z.number().nullable(),
  updated_at: z.number().nullable().optional(),
  change_24h_pct: z.number().nullable().optional(),
});

const variantSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
  type: z.enum(["raw", "graded"]),
  condition: z.string().nullable().optional(),
  printing: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  grading: gradingSchema.nullable().optional(),
  markets: z.array(marketSchema),
});

const gameSchema = z.object({ id: z.string(), name: z.string() });
const setSchema = z.object({ id: z.string(), name: z.string().nullable().optional() });

export const justTcgRawCardSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
  name: z.string(),
  game: gameSchema,
  set: setSchema,
  number: z.string().nullable().optional(),
  rarity: z.string().nullable().optional(),
  variants: z.array(variantSchema),
});
export type JustTcgRawCard = z.infer<typeof justTcgRawCardSchema>;
export type JustTcgRawVariant = z.infer<typeof variantSchema>;
export type JustTcgRawMarket = z.infer<typeof marketSchema>;

export const justTcgCardsResponseSchema = z.object({
  data: z.array(justTcgRawCardSchema),
  meta: z.object({ count: z.number().optional(), total: z.number().optional(), has_more: z.boolean().optional() }).optional(),
});
export type JustTcgCardsResponse = z.infer<typeof justTcgCardsResponseSchema>;
