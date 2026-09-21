import type { DataForSeoShoppingItem, DataForSeoTaskResult } from "./raw-types";
import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";
import { defaultTierForEvidenceType } from "../market-intelligence/evidence-tiers";

export interface NormalizeDataForSeoContext {
  categorySlug: string;
  query: string;
  country: string;
  collectedAt: string;
}

/**
 * Un résultat DataForSEO Google Shopping -> `MarketObservation` (LOT
 * "Source Wave 3", section 2). TOUJOURS `retailPrices`/palier E — cet
 * endpoint ne documente AUCUN champ `condition`/occasion (contrairement à
 * SerpApi, `second_hand_condition`) : jamais un palier D deviné faute de
 * signal explicite. `marketplace` = `domain` (nom de domaine du marchand
 * réel) si connu, sinon `seller` (nom affiché) — c'est précisément ce
 * champ que `dedupeByCanonicalOrigin` compare pour éviter de compter deux
 * fois une offre déjà vue via SerpApi (voir `market-intelligence/
 * canonical-origin-dedupe.ts`).
 *
 * Un résultat sans titre/prix/devise exploitable est simplement ignoré,
 * jamais une valeur inventée (même règle que `google-shopping/normalize.ts`).
 */
export function normalizeDataForSeoShoppingItem(item: DataForSeoShoppingItem, context: NormalizeDataForSeoContext): MarketObservation | null {
  const title = item.title;
  const sourceItemId = item.product_id ?? item.gid ?? item.shopping_url;
  const amount = item.price;
  const currency = item.currency;

  if (!title || !sourceItemId || amount === undefined || !currency) return null;

  const evidenceType = "retailPrices" as const;

  return {
    source: "dataforseo_google_shopping",
    sourceItemId,
    sourceUrl: item.shopping_url ?? null,
    observedAt: context.collectedAt,
    productKey: null,
    query: context.query,
    title,
    brand: null,
    model: null,
    variant: null,
    identifiers: item.product_id ? { googleProductId: item.product_id } : {},
    // Aucun signal de condition documenté par cet endpoint — jamais deviné.
    condition: null,
    completeness: null,
    priceAmountCents: Math.round(amount * 100),
    currency,
    shippingCostCents: null,
    totalPriceCents: null,
    country: context.country.toUpperCase(),
    marketplace: item.domain ?? item.seller ?? "dataforseo_google_shopping",
    evidenceType,
    evidenceTier: defaultTierForEvidenceType(evidenceType),
    // Un résultat Google Shopping n'est jamais une vente confirmée — même règle que SerpApi (ADR 0008).
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: { rankAbsolute: item.rank_absolute ?? null },
    ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
  };
}

export function normalizeDataForSeoTaskResult(result: DataForSeoTaskResult, context: NormalizeDataForSeoContext): MarketObservation[] {
  return (result.items ?? [])
    .map((item) => normalizeDataForSeoShoppingItem(item, context))
    .filter((o): o is MarketObservation => o !== null);
}
