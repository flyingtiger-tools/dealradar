import type { NormalizedListing as PipelineListing, NormalizedComparable, ItemCondition } from "@dealradar/core";

export interface ListingRow {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  condition: ItemCondition | null;
  attributes: Record<string, unknown>;
  first_seen_at: string;
}

export interface SoldListingRow {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  condition: ItemCondition | null;
  attributes: Record<string, unknown>;
  sold_at: string | null;
}

/** Sépare le `categorySlug` (métadonnée DealRadar) du reste des attributs (aspects source). */
function splitAttributes(raw: Record<string, unknown>): {
  categorySlug: string | null;
  attributes: Record<string, string | number | boolean>;
} {
  const { categorySlug, ...rest } = raw;
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[key] = value;
    }
  }
  return {
    categorySlug: typeof categorySlug === "string" && categorySlug.length > 0 ? categorySlug : null,
    attributes,
  };
}

/**
 * Ligne `listings` persistée → NormalizedListing du pipeline Lot 3. Retourne
 * `null` si la condition ou la catégorie sont inconnues — Intelligence Core
 * exige les deux et nous ne devinons jamais l'une ou l'autre.
 */
export function mapListingToIntelligence(row: ListingRow, sourceSlug: string): PipelineListing | null {
  if (!row.condition) return null;
  const { categorySlug, attributes } = splitAttributes(row.attributes ?? {});
  if (!categorySlug) return null;

  return {
    id: row.id,
    sourceSlug,
    title: row.title,
    priceCents: row.price_cents,
    currency: row.currency,
    condition: row.condition,
    categorySlug,
    attributes,
    postedAt: row.first_seen_at,
  };
}

export function mapSoldRowToComparable(
  row: SoldListingRow,
  sourceSlug: string,
  categorySlug: string,
): NormalizedComparable | null {
  if (!row.condition) return null;
  const { attributes } = splitAttributes(row.attributes ?? {});

  return {
    id: row.id,
    sourceSlug,
    title: row.title,
    priceCents: row.price_cents,
    currency: row.currency,
    condition: row.condition,
    categorySlug,
    attributes,
    soldAt: row.sold_at,
  };
}
