/**
 * Types du domaine DealRadar.
 * Source de vérité TypeScript, alignée sur supabase/migrations.
 * Toute évolution du schéma SQL doit être répercutée ici (et inversement).
 */

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
