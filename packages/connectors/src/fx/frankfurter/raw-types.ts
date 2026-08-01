import { z } from "zod";

/**
 * Schéma Zod de la réponse Frankfurter (`GET /v2/rates`) — champs confirmés
 * par la documentation officielle (frankfurter.dev), pas une supposition.
 * Contrairement à Open Exchange Rates, la réponse est un tableau plat
 * `[{date, base, quote, rate}, ...]`, une entrée par devise cible demandée.
 */
export const frankfurterRateEntrySchema = z.object({
  date: z.string(),
  base: z.string(),
  quote: z.string(),
  rate: z.number(),
});
export const frankfurterRatesResponseSchema = z.array(frankfurterRateEntrySchema);
export type FrankfurterRateEntry = z.infer<typeof frankfurterRateEntrySchema>;
export type FrankfurterRatesResponse = z.infer<typeof frankfurterRatesResponseSchema>;
