import type { CatalogItem, CatalogMatch } from "../../types";
import type { UpcDevProduct } from "./raw-types";

/**
 * `UpcDevProduct` → `CatalogItem` — ENRICHISSEMENT D'IDENTITÉ UNIQUEMENT
 * (LOT "Live Identity Enrichment + Barcode-First + upc.dev Fallback +
 * Railway Readiness", section 3), AUCUN prix (`priceHints` jamais peuplé
 * ici — upc.dev n'expose aucun prix dans la forme de réponse confirmée en
 * direct ce lot). `name` reste un texte libre agrégé de "dizaines de
 * sources" de qualité par-enregistrement non vérifiée (confirmé en direct :
 * un des produits testés est backé par Open Food Facts, dont DealRadar a
 * déjà un connecteur DIRECT plus fiable pour ce même rôle) — jamais utilisé
 * ici pour dériver `brand`/`model` (voir `enrich-product-identity.ts`,
 * `@dealradar/ingestion`, qui applique la même discipline conservatrice
 * qu'Open Food Facts/Open Products Facts pour cette raison).
 */
export function normalizeUpcDevProduct(raw: UpcDevProduct): CatalogItem {
  return {
    source: "upcdev",
    externalId: raw.upc,
    kind: "generic_product",
    categorySlug: "general",
    name: raw.name || raw.upc,
    canonicalAttributes: {
      upc: raw.upc,
      brand: raw.brand || null,
      category: raw.category || null,
    },
    images: raw.image_url ? [raw.image_url] : [],
    externalUrl: null,
    raw,
  };
}

/**
 * Correspondance EXACTE par code-barres uniquement — `GET /v1/product/
 * {upc}` renvoie au plus UN enregistrement, jamais une liste ambiguë
 * (contrairement à Wikidata/SPARQL) : aucune logique de désambiguïsation
 * n'est nécessaire ici.
 */
export function matchUpcDevProduct(raw: UpcDevProduct): CatalogMatch {
  return { item: normalizeUpcDevProduct(raw), confidence: 1, matchedOn: ["upc"] };
}
