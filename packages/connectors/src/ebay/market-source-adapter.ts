import type { MarketplaceConnector, NormalizedListing } from "../types";
import type { EvidenceType } from "../market-intelligence/evidence-types";
import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";
import { defaultTierForEvidenceType } from "../market-intelligence/evidence-tiers";
import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";

/**
 * Adapte le connecteur eBay EXISTANT (`createEbayConnector`, `connector.ts`,
 * inchangé) vers le contrat `MarketSource` (LOT "Multi-Source Fusion +
 * Source Wave 1") — enveloppe fine, jamais une réécriture : aucun code
 * OAuth/HTTP dupliqué, le connecteur eBay reste la SEULE implémentation de
 * ses appels réseau. Ce fichier ne fait que traduire `NormalizedListing` ->
 * `MarketObservation`.
 *
 * Déclare `activeListings` + `search` (+ `productDetails` via `getItem`) —
 * **jamais `soldTransactions`**, exactement comme le connecteur eBay
 * sous-jacent (`capabilities` n'a jamais déclaré `soldPrices`, voir ADR
 * 0008). Toute observation produite ici porte `evidenceTier: "D"` (annonce
 * active) — jamais A/B/C, jamais `soldAt` renseigné.
 *
 * Le filtrage lot/bundle/pièces détachées (`isLikelyBundleOrPartsListing`,
 * `@dealradar/core`) n'est PAS appliqué ICI : `packages/connectors` ne
 * dépend d'aucun paquet du monorepo (voir son `package.json`, ZERO
 * dépendance workspace) et ne doit jamais en acquérir une seule pour un
 * filtre — cette protection reste appliquée une fois, au niveau de la
 * fusion (`packages/core/src/intelligence/fuse-market-observations.ts`),
 * pour TOUTES les sources de façon uniforme plutôt que dupliquée
 * connecteur par connecteur.
 */

const EVIDENCE_TYPES: readonly EvidenceType[] = ["activeListings", "search", "productDetails"];

function toMarketObservation(listing: NormalizedListing, query: MarketSourceQuery, collectedAt: string): MarketObservation | null {
  if (!listing.condition) return null; // même règle que `gather-active-listing-evidence.ts` : jamais un état deviné.

  const evidenceType: EvidenceType = "activeListings";
  const shippingCostCents = listing.shippingCostCents;
  const totalPriceCents = shippingCostCents !== null ? listing.price.amountCents + shippingCostCents : null;

  return {
    source: "ebay",
    sourceItemId: listing.meta.externalId,
    sourceUrl: listing.meta.originalUrl,
    observedAt: collectedAt,
    productKey: null,
    query: query.q,
    title: listing.title,
    brand: null,
    model: null,
    variant: null,
    identifiers: {},
    condition: listing.condition,
    completeness: null,
    priceAmountCents: listing.price.amountCents,
    currency: listing.price.currency,
    shippingCostCents,
    totalPriceCents,
    country: listing.location.country,
    marketplace: "ebay",
    evidenceType,
    evidenceTier: defaultTierForEvidenceType(evidenceType),
    // eBay Browse API ne confirme jamais de vente (ADR 0008) — jamais déduit d'une disparition d'annonce.
    soldAt: null,
    // eBay ne renvoie pas de score de pertinence exploitable pour la requête textuelle — 1 par défaut (résultat déjà filtré côté eBay par `q`), jamais 0 qui suggérerait une non-correspondance à tort.
    matchScore: 1,
    rawMetadataRef: listing.meta.rawPayloadRef,
    ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
  };
}

export function createEbayMarketSourceAdapter(connector: MarketplaceConnector): MarketSource {
  return {
    source: "ebay",
    displayName: "eBay",
    supportedCategorySlugs: "any",
    evidenceTypes: EVIDENCE_TYPES,

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const collectedAt = new Date().toISOString();
      const result = await connector.search({ q: query.q, categorySlug: query.categorySlug, limit: query.limit, signal: query.signal });
      const observations = result.listings
        .map((listing) => toMarketObservation(listing, query, collectedAt))
        .filter((obs): obs is MarketObservation => obs !== null);
      return { observations, hasMore: result.hasMore };
    },

    async healthCheck() {
      return connector.healthCheck();
    },
  };
}
