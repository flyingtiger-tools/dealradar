import { z } from "zod";

/**
 * Schéma Zod du sous-ensemble de l'API Product Opener v2
 * (`GET /api/v2/product/{barcode}.json`, hôtes `world.openfoodfacts.org` et
 * `world.openproductsfacts.org` — même backend, même forme de réponse) que
 * nous consommons réellement — champs confirmés par des appels réels ce lot
 * (LOT "Free/Open Sources + Real Readiness + Live Smoke Tests", section 3),
 * pas une supposition sur la documentation :
 *   - `3017620422003` (Nutella, Open Food Facts) → status 1, "product found"
 *   - `3450970084468` (GEL WC, Open Products Facts) → status 1, "product found"
 *   - `0000000000000` → status 0, "no code or invalid code"
 *   - `8710447452746` → status 0, "product not found"
 *   - `3014230021404` → status 0, "product found with a different product
 *     type: beauty" (appartient à un projet frère distinct, Open Beauty
 *     Facts — JAMAIS traité comme une correspondance par ce connecteur,
 *     voir normalize.ts : seul `status === 1` compte).
 */

export const openFactsProductSchema = z.object({
  code: z.string().optional(),
  product_name: z.string().optional(),
  brands: z.string().optional(),
  categories: z.string().optional(),
  categories_tags: z.array(z.string()).optional(),
  quantity: z.string().optional(),
  product_quantity: z.number().optional(),
  product_quantity_unit: z.string().optional(),
  packaging: z.string().optional(),
  image_url: z.string().optional(),
  image_front_url: z.string().optional(),
});
export type OpenFactsProduct = z.infer<typeof openFactsProductSchema>;

export const openFactsResponseSchema = z.object({
  code: z.string(),
  status: z.number(),
  status_verbose: z.string().optional(),
  product: openFactsProductSchema.optional(),
});
export type OpenFactsResponse = z.infer<typeof openFactsResponseSchema>;
