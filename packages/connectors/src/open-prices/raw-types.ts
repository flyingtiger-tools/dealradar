import { z } from "zod";

/**
 * Schéma Zod du sous-ensemble de `GET https://prices.openfoodfacts.org/api/v1/prices`
 * que nous consommons réellement — champs confirmés par un appel réel ce
 * lot (LOT "Free/Open Sources + Real Readiness + Live Smoke Tests",
 * section 6/13) : `GET /api/v1/prices?product_code=1541513213246&page_size=2`.
 * Beaucoup de champs source (proof, location OSM détaillé, nutriscore…)
 * sont OMIS volontairement — non pertinents à un prix de revente
 * DealRadar, jamais un sur-couplage à des champs alimentaires.
 */
const openPricesLocationSchema = z.object({
  /** Code pays à 2 lettres (ex. "FR") — jamais le nom complet du pays (`osm_address_country`), pour rester cohérent avec `MarketObservation.country` ailleurs dans le projet (ex. "CH"/"US"). */
  osm_address_country_code: z.string().nullable().optional(),
  osm_display_name: z.string().nullable().optional(),
});

export const openPricesItemSchema = z.object({
  id: z.number(),
  product_code: z.string().nullable().optional(),
  /** Souvent `null` (donnée communautaire incomplète, confirmé par appel réel) — jamais un titre inventé si absent (voir `normalize.ts`, repli sur le code-barres). */
  product_name: z.string().nullable().optional(),
  price: z.number(),
  currency: z.string(),
  price_is_discounted: z.boolean().nullable().optional(),
  date: z.string().nullable().optional(),
  location: openPricesLocationSchema.nullable().optional(),
  created: z.string(),
});
export type OpenPricesItem = z.infer<typeof openPricesItemSchema>;

export const openPricesResponseSchema = z.object({
  items: z.array(openPricesItemSchema),
  total: z.number().optional(),
});
export type OpenPricesResponse = z.infer<typeof openPricesResponseSchema>;
