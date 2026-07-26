/**
 * Types du domaine DealRadar.
 * Source de vérité TypeScript, alignée sur supabase/migrations.
 * Toute évolution du schéma SQL doit être répercutée ici (et inversement).
 */
import type { SearchQuery } from "../validation/schemas";

export type UserRole = "free" | "premium" | "admin";

export type ItemCondition =
  | "new"
  | "like_new"
  | "very_good"
  | "good"
  | "fair"
  | "for_parts";

export type ListingStatus = "active" | "sold" | "expired" | "removed" | "flagged";

/** Le signal produit central : la réponse à « Know When ». */
export type Verdict = "buy" | "wait" | "sell";

export interface Listing {
  id: string;
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  description: string | null;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  condition: ItemCondition | null;
  categoryId: string | null;
  brandId: string | null;
  attributes: Record<string, string | number | boolean>;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Annonce brute produite par un adapter de source, avant normalisation. */
export interface RawListing {
  externalId: string;
  url: string;
  title: string;
  description?: string;
  priceCents: number;
  currency: string;
  imageUrls: string[];
  sellerExternalId?: string;
  locationText?: string;
  postedAt?: string;
  raw: unknown;
}

export interface ComparableMember {
  listingId: string;
  similarity: number;
  priceCents: number;
}

export interface ComparableSet {
  id: string;
  listingId: string;
  method: string;
  members: ComparableMember[];
  computedAt: string;
}

export interface Score {
  listingId: string;
  scoreType: "deal" | "risk" | "trust";
  value: number;
  verdict: Verdict | null;
  engineVersion: string;
  comparableSetId: string | null;
  explanation: Record<string, unknown>;
}

export interface Category {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  path: string;
  depth: number;
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
}

export interface Watchlist {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Présent uniquement quand la ligne vient d'une requête avec l'embed `watchlist_items(count)`. */
  itemCount?: number;
}

export interface WatchlistItem {
  watchlistId: string;
  listingId: string;
  note: string | null;
  addedAt: string;
}

export type AlertKind = "price_below" | "new_match" | "verdict_change" | "back_in_market";

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  query: Partial<SearchQuery>;
  createdAt: string;
}

export interface Alert {
  id: string;
  userId: string;
  kind: AlertKind;
  listingId: string | null;
  savedSearchId: string | null;
  params: { thresholdCents?: number };
  isActive: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

export type PortfolioStatus = "held" | "listed" | "sold";

export interface PortfolioPosition {
  id: string;
  userId: string;
  title: string;
  categoryId: string | null;
  brandId: string | null;
  condition: ItemCondition | null;
  acquiredAt: string | null;
  acquiredPriceCents: number | null;
  currency: string;
  sourceListingId: string | null;
  status: PortfolioStatus;
  soldAt: string | null;
  soldPriceCents: number | null;
  createdAt: string;
  updatedAt: string;
}
