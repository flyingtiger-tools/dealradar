import { z } from "zod";

/**
 * Validation Zod à la frontière de persistance des observations de prix TCG
 * (LOT 5) — ce qu'un `TcgCrossMatchResult.identity`/`priceObservations[0]`
 * a bien voulu fournir, avant que `persist-tcg-price-observation.ts` ne le
 * transforme en ligne `tcg_price_observations`. Aucune conversion de devise
 * ici, aucune tolérance sur `productKind` au-delà de raw/gradé.
 */

export const tcgPriceObservationInputSchema = z.object({
  categorySlug: z.string().min(1),
  source: z.string().min(1),
  externalProductId: z.string().min(1),
  catalogSource: z.string().min(1),
  catalogExternalId: z.string().min(1),
  game: z.string().min(1),
  name: z.string().min(1),
  setName: z.string().nullable(),
  cardNumber: z.string().nullable(),
  variant: z.string().nullable(),
  language: z.string().nullable(),
  productKind: z.enum(["raw_card", "graded_card"]),
  condition: z.string().nullable(),
  gradingCompany: z.string().nullable(),
  grade: z.string().nullable(),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  priceType: z.enum(["market_aggregate", "listing", "sold"]),
  region: z.string().min(1),
  provenance: z.string().min(1),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
  sourceUpdatedAt: z.string().nullable(),
});
export type ValidatedTcgPriceObservationInput = z.infer<typeof tcgPriceObservationInputSchema>;
