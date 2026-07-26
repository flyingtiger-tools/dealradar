import { z } from "zod";
import { itemConditionSchema } from "@dealradar/contracts";

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

/** Source de vérité : @dealradar/contracts. Ré-exporté ici pour ne casser aucun import existant. */
export { itemConditionSchema };

export const searchQuerySchema = z.object({
  q: z.string().max(200).default(""),
  categoryPath: z.string().max(200).optional(),
  brandSlug: z.string().max(100).optional(),
  condition: itemConditionSchema.optional(),
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

// ── Rows Supabase (snake_case) → domaine (camelCase) ──────────

export const categoryRowSchema = z
  .object({
    id: z.string(),
    parent_id: z.string().nullable(),
    slug: z.string(),
    name: z.string(),
    path: z.string(),
    depth: z.number(),
  })
  .transform((r) => ({
    id: r.id, parentId: r.parent_id, slug: r.slug, name: r.name, path: r.path, depth: r.depth,
  }));

export const brandRowSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    aliases: z.array(z.string()),
  })
  .transform((r) => ({ id: r.id, slug: r.slug, name: r.name, aliases: r.aliases }));

export const watchlistRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    name: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    watchlist_items: z.array(z.object({ count: z.number() })).optional(),
  })
  .transform((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    itemCount: r.watchlist_items?.[0]?.count,
  }));

export const watchlistItemRowSchema = z
  .object({
    watchlist_id: z.string(),
    listing_id: z.string(),
    note: z.string().nullable(),
    added_at: z.string(),
  })
  .transform((r) => ({
    watchlistId: r.watchlist_id, listingId: r.listing_id, note: r.note, addedAt: r.added_at,
  }));

export const savedSearchRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    name: z.string(),
    query: z.unknown(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    query: searchQuerySchema.partial().parse(r.query),
    createdAt: r.created_at,
  }));

export const alertKindSchema = z.enum([
  "price_below", "new_match", "verdict_change", "back_in_market",
]);

export const alertRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    kind: alertKindSchema,
    listing_id: z.string().nullable(),
    saved_search_id: z.string().nullable(),
    params: z.unknown(),
    is_active: z.boolean(),
    last_fired_at: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    listingId: r.listing_id,
    savedSearchId: r.saved_search_id,
    params: alertParamsSchema.parse(r.params ?? {}),
    isActive: r.is_active,
    lastFiredAt: r.last_fired_at,
    createdAt: r.created_at,
  }));

export const portfolioStatusSchema = z.enum(["held", "listed", "sold"]);

export const portfolioPositionRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    title: z.string(),
    category_id: z.string().nullable(),
    brand_id: z.string().nullable(),
    condition: itemConditionSchema.nullable(),
    acquired_at: z.string().nullable(),
    acquired_price_cents: z.number().nullable(),
    currency: z.string(),
    source_listing_id: z.string().nullable(),
    status: portfolioStatusSchema,
    sold_at: z.string().nullable(),
    sold_price_cents: z.number().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .transform((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    categoryId: r.category_id,
    brandId: r.brand_id,
    condition: r.condition,
    acquiredAt: r.acquired_at,
    acquiredPriceCents: r.acquired_price_cents,
    currency: r.currency,
    sourceListingId: r.source_listing_id,
    status: r.status,
    soldAt: r.sold_at,
    soldPriceCents: r.sold_price_cents,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

// ── Inputs formulaire (camelCase) ─────────────────────────────

export const createWatchlistInputSchema = z.object({
  name: z.string().min(1).max(100),
});

export const addWatchlistItemInputSchema = z.object({
  listingId: z.string().uuid(),
  note: z.string().max(500).optional(),
});

export const createSavedSearchInputSchema = z.object({
  name: z.string().min(1).max(100),
  query: searchQuerySchema,
});

export const createAlertInputSchema = z
  .object({
    kind: alertKindSchema,
    listingId: z.string().uuid().optional(),
    savedSearchId: z.string().uuid().optional(),
    params: alertParamsSchema.default({}),
  })
  .refine((v) => v.listingId !== undefined || v.savedSearchId !== undefined, {
    message: "Une alerte cible une annonce ou une recherche sauvegardée.",
    path: ["savedSearchId"],
  });

export const updateAlertInputSchema = z.object({
  isActive: z.boolean().optional(),
  params: alertParamsSchema.optional(),
});

export const createPortfolioPositionInputSchema = z.object({
  title: z.string().min(1).max(300),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  condition: itemConditionSchema.optional(),
  acquiredAt: z.string().date().optional(),
  acquiredPriceCents: z.number().int().nonnegative().optional(),
  sourceListingId: z.string().uuid().optional(),
});

export const markPositionSoldInputSchema = z.object({
  soldAt: z.string().date(),
  soldPriceCents: z.number().int().nonnegative(),
});
