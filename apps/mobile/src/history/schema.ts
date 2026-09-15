import { z } from "zod";

/**
 * Validation structurelle du manifest d'historique local (Phase 46/47) —
 * même discipline que `dataset-capture/manifest-schema.ts` : un manifest
 * structurellement invalide est détecté explicitement, jamais réparé
 * silencieusement ni laissé provoquer un crash plus loin dans l'app.
 */

const historyIdentitySchema = z.object({
  name: z.string().nullable(),
  setName: z.string().nullable(),
  collectorNumber: z.string().nullable(),
  language: z.string().nullable(),
  variant: z.string().nullable(),
});

const historyMarketValueSchema = z.object({
  low: z.number(),
  high: z.number(),
  currency: z.string(),
});

const historyEntrySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  category: z.literal("pokemon_tcg"),
  identity: historyIdentitySchema,
  verdict: z.enum(["BUY", "REVIEW", "PASS", "INSUFFICIENT_DATA"]).nullable(),
  marketValue: historyMarketValueSchema.nullable(),
  confidence: z.number().nullable(),
  source: z.string().nullable(),
  favorite: z.boolean(),
  productKey: z.string().min(1),
});

export const historyManifestSchema = z.object({
  schemaVersion: z.number(),
  entries: z.array(historyEntrySchema),
});
