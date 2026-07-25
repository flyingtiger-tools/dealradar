import { z } from "zod";

/**
 * Schémas Zod : validation aux frontières (API, jobs, env).
 * Règle : aucune donnée externe n'entre dans le système sans passer ici.
 */

export const rawListingSchema = z.object({
  externalId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  imageUrls: z.array(z.string().url()).max(30),
  sellerExternalId: z.string().optional(),
  locationText: z.string().max(200).optional(),
  postedAt: z.string().datetime().optional(),
  raw: z.unknown(),
});

export const searchQuerySchema = z.object({
  q: z.string().max(200).default(""),
  categoryPath: z.string().max(200).optional(),
  brandSlug: z.string().max(100).optional(),
  condition: z
    .enum(["new", "like_new", "very_good", "good", "fair", "for_parts"])
    .optional(),
  minPriceCents: z.number().int().nonnegative().optional(),
  maxPriceCents: z.number().int().nonnegative().optional(),
  verdict: z.enum(["buy", "wait", "sell"]).optional(),
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const alertParamsSchema = z.object({
  thresholdCents: z.number().int().positive().optional(),
});
