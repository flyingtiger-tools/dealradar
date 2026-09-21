import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";

/**
 * Parseur de page publique Ricardo.ch (LOT "Source Wave 2", section 3) —
 * fonction PURE : reçoit du HTML déjà récupéré par un `ScrapingProvider`
 * (jamais elle-même un `fetch`, voir `connector.ts` pour l'assemblage), le
 * transforme en `MarketObservation[]`. Jamais spécifique à un vendeur de
 * scraping (Zyte/Bright Data/Apify) — reçoit juste une chaîne HTML.
 *
 * **STATUT D'ACCÈS, IMPORTANT** (voir `docs/market-intelligence-
 * sources.md` pour le détail complet des constats) : Ricardo.ch n'a AUCUNE
 * API publique en libre-service (l'API officielle documentée est archivée,
 * date de 2013, et exige un `PartnershipID`/`PartnershipPWD` négocié — pas
 * un accès ouvert). Le site utilise Cloudflare et son `robots.txt` exclut
 * explicitement les robots d'indexation/scraping connus ainsi que sa propre
 * API JSON interne (`/api/mfa/search`, `/marketplace-spa/api/`). Ce fichier
 * implémente donc le CONTRAT du parseur avec des fixtures réalistes
 * (structure JSON-LD schema.org standard, couramment utilisée par les sites
 * e-commerce pour le référencement) — **NOT TESTED live**, activation en
 * production non recommandée sans clarification légale/technique
 * supplémentaire (voir doc).
 *
 * Approche volontairement générique plutôt qu'un ciblage de sélecteurs CSS
 * fragiles propres à Ricardo : cherche des blocs `<script
 * type="application/ld+json">` au format schema.org `Product`/`Offer`
 * (vocabulaire standard, largement utilisé pour le SEO produit, y compris
 * sur des pages dont le rendu visuel dépend de JavaScript) — si Ricardo
 * n'émet pas ce balisage en pratique, ce parseur retournera simplement un
 * tableau vide plutôt qu'une extraction incorrecte, jamais un prix deviné à
 * partir d'un texte libre non structuré.
 */

interface SchemaOrgOffer {
  price?: string | number;
  priceCurrency?: string;
  availability?: string;
  itemCondition?: string;
  url?: string;
}

interface SchemaOrgProduct {
  "@type"?: string;
  name?: string;
  sku?: string;
  url?: string;
  offers?: SchemaOrgOffer | SchemaOrgOffer[];
}

interface SchemaOrgGraph {
  "@graph"?: (SchemaOrgProduct | Record<string, unknown>)[];
}

/** Extrait le contenu de chaque bloc `<script type="application/ld+json">...</script>` — regex volontairement simple, jamais un parseur DOM complet (le paquet `connectors` a zéro dépendance, voir `package.json`). */
function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const content = match[1];
    if (content) blocks.push(content.trim());
  }
  return blocks;
}

function parseJsonLdBlock(raw: string): (SchemaOrgProduct | Record<string, unknown>)[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    const graph = (parsed as SchemaOrgGraph)["@graph"];
    if (Array.isArray(graph)) return graph;
    return [parsed as Record<string, unknown>];
  } catch {
    return [];
  }
}

function isProduct(entry: SchemaOrgProduct | Record<string, unknown>): entry is SchemaOrgProduct {
  return (entry as SchemaOrgProduct)["@type"] === "Product";
}

function firstOffer(offers: SchemaOrgOffer | SchemaOrgOffer[] | undefined): SchemaOrgOffer | null {
  if (!offers) return null;
  return Array.isArray(offers) ? (offers[0] ?? null) : offers;
}

/**
 * Condition schema.org (`itemCondition`, ex. "https://schema.org/UsedCondition")
 * -> vocabulaire brut DealRadar simple. Valeur non reconnue -> `null`,
 * jamais devinée (même discipline que `ebay/normalize.ts`).
 */
function normalizeItemCondition(itemCondition: string | undefined): string | null {
  if (!itemCondition) return null;
  const lower = itemCondition.toLowerCase();
  if (lower.includes("newcondition")) return "new";
  if (lower.includes("usedcondition")) return "used";
  if (lower.includes("refurbishedcondition")) return "refurbished";
  if (lower.includes("damagedcondition")) return "damaged";
  return null;
}

export interface ParseRicardoContext {
  query: string;
  collectedAt: string;
  /** URL de la page effectivement récupérée — jamais reconstruite, voir `sourceUrl` sur chaque observation. */
  pageUrl: string;
}

/**
 * HTML de page Ricardo.ch déjà récupéré -> `MarketObservation[]`. Toujours
 * `evidenceType: "activeListings"`, palier D (annonce active, jamais une
 * vente confirmée) — Ricardo ne fournit aucune preuve de vente conclue
 * dans ce balisage. `soldAt` toujours `null`. Un produit sans prix/devise
 * exploitable est simplement ignoré, jamais une valeur inventée.
 */
export function parseRicardoListingHtml(html: string, context: ParseRicardoContext): MarketObservation[] {
  const observations: MarketObservation[] = [];

  for (const block of extractJsonLdBlocks(html)) {
    for (const entry of parseJsonLdBlock(block)) {
      if (!isProduct(entry)) continue;

      const offer = firstOffer(entry.offers);
      const rawPrice = offer?.price;
      const priceAmount = typeof rawPrice === "string" ? Number.parseFloat(rawPrice) : rawPrice;
      const currency = offer?.priceCurrency;
      const title = entry.name;
      const sourceUrl = entry.url ?? offer?.url ?? null;

      if (!title || priceAmount === undefined || priceAmount === null || Number.isNaN(priceAmount) || !currency) continue;

      const sourceItemId = entry.sku ?? sourceUrl ?? title;

      observations.push({
        source: "ricardo",
        sourceItemId,
        sourceUrl,
        observedAt: context.collectedAt,
        productKey: null,
        query: context.query,
        title,
        brand: null,
        model: null,
        variant: null,
        identifiers: {},
        condition: normalizeItemCondition(offer?.itemCondition),
        completeness: null,
        priceAmountCents: Math.round(priceAmount * 100),
        currency,
        shippingCostCents: null,
        totalPriceCents: null,
        country: "CH",
        marketplace: "ricardo",
        evidenceType: "activeListings",
        evidenceTier: "D",
        // Une annonce active, jamais une vente confirmée — règle absolue du lot.
        soldAt: null,
        matchScore: 1,
        rawMetadataRef: { pageUrl: context.pageUrl, availability: offer?.availability ?? null },
        ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
      });
    }
  }

  return observations;
}
