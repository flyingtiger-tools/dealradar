import { z } from "zod";
import { categorySlugSchema, itemConditionSchema } from "@dealradar/contracts";

/**
 * Miroir Zod exact de `EbayRawItemSummary`/`EbayRawItem`
 * (packages/connectors/src/ebay/raw-types.ts) — aucun champ hors de ce
 * sous-ensemble n'est accepté. Un dataset de ce lot doit rester
 * remplaçable par un export réel de l'API Browse sans changement de code :
 * ajouter un champ ici sans qu'il existe dans `raw-types.ts` romprait cette
 * garantie.
 */
const ebayRawMoneySchema = z.object({
  value: z.string().optional(),
  currency: z.string().optional(),
});

const ebayRawImageSchema = z.object({
  imageUrl: z.string().optional(),
});

const ebayRawSellerSchema = z.object({
  username: z.string().optional(),
  feedbackPercentage: z.string().optional(),
  feedbackScore: z.number().optional(),
});

const ebayRawShippingOptionSchema = z.object({
  shippingCost: ebayRawMoneySchema.optional(),
});

const ebayRawItemLocationSchema = z.object({
  country: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
});

const ebayRawCategorySchema = z.object({
  categoryId: z.string().optional(),
  categoryName: z.string().optional(),
});

const ebayRawAspectSchema = z.object({
  name: z.string().optional(),
  value: z.string().optional(),
});

export const ebayRawItemSchema = z.object({
  itemId: z.string().optional(),
  title: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  price: ebayRawMoneySchema.optional(),
  itemWebUrl: z.string().optional(),
  image: ebayRawImageSchema.optional(),
  additionalImages: z.array(ebayRawImageSchema).optional(),
  condition: z.string().optional(),
  conditionId: z.string().optional(),
  seller: ebayRawSellerSchema.optional(),
  itemLocation: ebayRawItemLocationSchema.optional(),
  shippingOptions: z.array(ebayRawShippingOptionSchema).optional(),
  categories: z.array(ebayRawCategorySchema).optional(),
  itemCreationDate: z.string().optional(),
  localizedAspects: z.array(ebayRawAspectSchema).optional(),
});
export type EbayRawItemLike = z.infer<typeof ebayRawItemSchema>;

/**
 * Annotation benchmark seule (jamais un champ Browse API réel) : sert à
 * mesurer la précision d'identification déterministe et à alimenter la
 * régression. Absente = pas de vérification de précision pour cette entrée.
 */
const expectedAnnotationSchema = z.object({
  sufficientDeterministic: z.boolean().optional(),
  condition: itemConditionSchema.optional(),
});

export const datasetItemSchema = z.object({
  raw: ebayRawItemSchema,
  expected: expectedAnnotationSchema.optional(),
});
export type DatasetItem = z.infer<typeof datasetItemSchema>;

/**
 * `soldAt` est une annotation du benchmark, jamais un champ Browse API réel
 * — l'API Browse ne restitue pas les ventes conclues (ADR 0008). Sert
 * uniquement à construire un pool de comparables pour exercer Intelligence
 * Core au-delà de INSUFFICIENT_DATA sur ce dataset synthétique.
 */
export const datasetComparableSchema = z.object({
  raw: ebayRawItemSchema,
  soldAt: z.string(),
});
export type DatasetComparable = z.infer<typeof datasetComparableSchema>;

export const datasetSchema = z.object({
  categorySlug: categorySlugSchema,
  /**
   * `synthetic` : jeu de données fabriqué pour ce lot, fidèle à la forme de
   * l'API mais pas à son contenu réel. `real` : export réel de l'API Browse
   * — n'existe pas encore dans ce projet (aucun identifiant eBay réel).
   * Ne jamais agréger des résultats de provenances différentes (voir
   * `metrics/aggregate.ts`).
   */
  provenance: z.enum(["synthetic", "real"]),
  note: z.string().optional(),
  items: z.array(datasetItemSchema).min(1),
  comparables: z.array(datasetComparableSchema).optional().default([]),
});
export type Dataset = z.infer<typeof datasetSchema>;
