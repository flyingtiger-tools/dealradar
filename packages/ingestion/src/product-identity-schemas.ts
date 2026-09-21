import { z } from "zod";

/** Validation Zod à la frontière de persistance d'une `CanonicalProductIdentity` (`@dealradar/core`) — voir `persist-canonical-product-identity.ts`. */
export const fieldClaimInputSchema = z.object({
  value: z.string().min(1),
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  observedAt: z.string().min(1),
});

export const canonicalProductIdentityInputSchema = z.object({
  productKey: z.string().min(1),
  categorySlug: z.string().min(1),
  fields: z.record(z.string(), fieldClaimInputSchema.nullish()),
  aliases: z.array(fieldClaimInputSchema.extend({ field: z.string().min(1) })),
});
export type ValidatedCanonicalProductIdentityInput = z.infer<typeof canonicalProductIdentityInputSchema>;
