import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";
import type { OpenPricesItem } from "./raw-types";

export interface NormalizeOpenPricesContext {
  categorySlug: string;
  query: string;
  collectedAt: string;
}

/**
 * `OpenPricesItem` → `MarketObservation` (LOT "Free/Open Sources + Real
 * Readiness + Live Smoke Tests", section 6) — TOUJOURS `evidenceType:
 * "retailPrices"` (jamais `soldTransactions`/`activeListings` : un prix
 * observé/scanné en magasin par un contributeur communautaire n'est NI
 * une vente confirmée NI une annonce active), `soldAt: null` sans
 * exception. `matchScore` reflète honnêtement une correspondance EXACTE
 * de code-barres (1 — le serveur a déjà filtré par `product_code` exact,
 * jamais une similarité devinée côté client).
 */
export function normalizeOpenPricesItem(item: OpenPricesItem, context: NormalizeOpenPricesContext): MarketObservation {
  const priceAmountCents = Math.round(item.price * 100);

  return {
    source: "open_prices",
    sourceItemId: String(item.id),
    // Aucune URL produit directe fournie par Open Prices pour une entrée de
    // prix individuelle (confirmé par audit du schéma réel ce lot) — jamais
    // une URL reconstruite/devinée.
    sourceUrl: null,
    observedAt: item.date ?? item.created,
    productKey: null,
    query: context.query,
    title: item.product_name ?? item.product_code ?? context.query,
    brand: null,
    model: null,
    variant: null,
    identifiers: item.product_code ? { barcode: item.product_code } : {},
    // Open Prices ne rapporte jamais l'état de l'article (donnée hors
    // scope du projet — un prix observé en rayon, pas une fiche produit
    // d'occasion) — jamais deviné.
    condition: null,
    completeness: null,
    priceAmountCents,
    currency: item.currency,
    shippingCostCents: null,
    totalPriceCents: null,
    country: item.location?.osm_address_country_code ?? null,
    marketplace: item.location?.osm_display_name ?? "open_prices",
    evidenceType: "retailPrices",
    evidenceTier: "E",
    soldAt: null,
    matchScore: 1,
    rawMetadataRef: null,
    ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
  };
}
