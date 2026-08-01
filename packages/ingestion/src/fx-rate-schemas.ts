import { z } from "zod";

/**
 * Validation Zod à la frontière de persistance d'un `FxRate`
 * (`@dealradar/connectors`) — voir `persist-fx-rate.ts`.
 */
export const fxRateInputSchema = z.object({
  baseCurrency: z.string().length(3),
  quoteCurrency: z.string().length(3),
  rate: z.number().positive(),
  rateDate: z.string().min(1),
  source: z.string().min(1),
  fetchedAt: z.string().min(1),
});
export type ValidatedFxRateInput = z.infer<typeof fxRateInputSchema>;
