import { z } from "zod";

/**
 * Validation Zod du NormalizedListing produit par un connecteur, avant
 * toute persistance — frontière entre "ce qu'une source a bien voulu nous
 * donner" et "ce que notre schéma garantit".
 */

export const itemConditionRawSchema = z
  .enum(["new", "like_new", "very_good", "good", "fair", "for_parts"])
  .nullable();

export const normalizedPriceSchema = z.object({
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export const normalizedImageSchema = z.object({
  url: z.string().url(),
  position: z.number().int().nonnegative(),
});

export const normalizedSellerSchema = z.object({
  externalId: z.string().nullable(),
  username: z.string().nullable(),
  feedbackScore: z.number().nullable(),
  feedbackPercentage: z.number().nullable(),
});

export const normalizedLocationSchema = z.object({
  country: z.string().nullable(),
  postalCode: z.string().nullable(),
  text: z.string().nullable(),
});

export const sourceMetadataSchema = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  originalUrl: z.string().url(),
  collectedAt: z.string(),
  rawPayloadRef: z.unknown().optional(),
});

export const normalizedListingSchema = z.object({
  meta: sourceMetadataSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  price: normalizedPriceSchema,
  shippingCostCents: z.number().int().nonnegative().nullable(),
  condition: itemConditionRawSchema,
  categorySlug: z.string().min(1),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])),
  location: normalizedLocationSchema,
  images: z.array(normalizedImageSchema),
  seller: normalizedSellerSchema,
  postedAt: z.string().nullable(),
});
export type ValidatedNormalizedListing = z.infer<typeof normalizedListingSchema>;
