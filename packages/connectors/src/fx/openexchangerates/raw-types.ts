import { z } from "zod";

/**
 * Schéma Zod de la réponse Open Exchange Rates (`/latest.json`,
 * `/historical/{date}.json`) — champs confirmés par la documentation
 * officielle (docs.openexchangerates.org), pas une supposition. Même forme
 * pour les deux routes : `{disclaimer, license, timestamp, base, rates}`.
 */
export const openExchangeRatesResponseSchema = z.object({
  disclaimer: z.string().optional(),
  license: z.string().optional(),
  timestamp: z.number(),
  base: z.string(),
  rates: z.record(z.string(), z.number()),
});
export type OpenExchangeRatesResponse = z.infer<typeof openExchangeRatesResponseSchema>;

/** Forme d'erreur documentée — https://docs.openexchangerates.org/reference/errors */
export const openExchangeRatesErrorSchema = z.object({
  error: z.literal(true),
  status: z.number(),
  message: z.string(),
  description: z.string().optional(),
});
export type OpenExchangeRatesError = z.infer<typeof openExchangeRatesErrorSchema>;
