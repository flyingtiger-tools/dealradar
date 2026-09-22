import { z } from "zod";

/**
 * Schéma Zod de `GET /v1/product/{upc}` (`upc.dev`) — LOT "Live Identity
 * Enrichment + Barcode-First + upc.dev Fallback + Railway Readiness",
 * section 3. CONFIRMÉ par appel réel ce lot (voir `connector.ts` pour le
 * détail des barcodes testés) : `brand`/`category`/`description` peuvent
 * être des CHAÎNES VIDES (jamais `null`/absentes) plutôt que réellement
 * omises — tous les champs sauf `upc` restent `.optional()` par prudence
 * défensive plutôt que supposés systématiquement présents et non-vides.
 *
 * HONNÊTETÉ : la réponse observée en direct ce lot inclut aussi
 * `verified`/`validation_status`/`banner` (non documentés par le schéma
 * OpenAPI public) — ces champs supplémentaires sont IGNORÉS par ce schéma
 * (`z.object` sans `.strict()`, Zod les tolère silencieusement) plutôt que
 * modélisés, car leur sémantique exacte n'a pas été confirmée et ils ne
 * sont pas nécessaires à `normalizeUpcDevProduct`.
 */
export const upcDevProductSchema = z.object({
  upc: z.string(),
  name: z.string().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  image_url: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});
export type UpcDevProduct = z.infer<typeof upcDevProductSchema>;

export const upcDevSuccessResponseSchema = z.object({
  ok: z.literal(true),
  data: upcDevProductSchema,
  timestamp: z.string().optional(),
});
export type UpcDevSuccessResponse = z.infer<typeof upcDevSuccessResponseSchema>;
