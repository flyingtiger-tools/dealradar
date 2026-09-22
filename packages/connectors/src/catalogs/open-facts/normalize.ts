import type { CatalogItem, CatalogMatch } from "../../types";
import type { OpenFactsResponse } from "./raw-types";

/**
 * `true` UNIQUEMENT si `status === 1` — TOUT le reste (0 avec
 * "product not found", "no code or invalid code", ou même le cas réel
 * découvert ce lot "product found with a different product type: beauty",
 * qui appartient à un projet frère distinct comme Open Beauty Facts) est
 * honnêtement traité comme "aucune correspondance ICI", jamais une
 * correspondance partielle ni une redirection devinée vers un autre projet
 * frère non demandé.
 */
export function isOpenFactsMatch(response: OpenFactsResponse): boolean {
  return response.status === 1 && response.product !== undefined;
}

/**
 * Réponse Product Opener → `CatalogItem` — ENRICHISSEMENT D'IDENTITÉ/
 * CATALOGUE UNIQUEMENT (LOT "Free/Open Sources + Real Readiness + Live
 * Smoke Tests", section 3) : `priceHints` n'est JAMAIS peuplé ici, contrairement
 * aux Catalog Connectors TCG — Open Food Facts/Open Products Facts ne
 * fournissent aucune donnée de prix, jamais inventée pour combler ce vide.
 */
export function normalizeOpenFactsProduct(response: OpenFactsResponse, source: string, baseUrl: string, categorySlug: string): CatalogItem {
  const product = response.product ?? {};
  const images = [product.image_front_url, product.image_url].filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index);

  return {
    source,
    externalId: response.code,
    kind: "barcode_product",
    categorySlug,
    name: product.product_name ?? response.code,
    canonicalAttributes: {
      brands: product.brands ?? null,
      categories: product.categories ?? null,
      quantity: product.quantity ?? null,
      productQuantity: product.product_quantity ?? null,
      productQuantityUnit: product.product_quantity_unit ?? null,
      packaging: product.packaging ?? null,
    },
    images,
    // Attribution ODbL (LOT "Free/Open Sources...", section 3 — requise par
    // les conditions d'utilisation d'Open Food Facts/Open Products Facts,
    // audit confirmé) : lien direct vers la fiche produit d'origine, jamais
    // une URL de recherche générique.
    externalUrl: `${baseUrl.replace(/\/$/, "")}/product/${encodeURIComponent(response.code)}`,
    raw: response,
  };
}

/**
 * Correspondance EXACTE uniquement — un code-barres soit correspond au
 * produit interrogé, soit ne correspond à rien (jamais une correspondance
 * partielle sur un identifiant exact, contrairement au nom flou d'une
 * carte TCG). Confiance 1 si trouvé, aucun `CatalogMatch` sinon (voir
 * `connector.ts`, qui renvoie un tableau vide plutôt qu'un match à confiance
 * nulle).
 */
export function matchOpenFactsProduct(response: OpenFactsResponse, source: string, baseUrl: string, categorySlug: string): CatalogMatch {
  return {
    item: normalizeOpenFactsProduct(response, source, baseUrl, categorySlug),
    confidence: 1,
    matchedOn: ["barcode"],
  };
}
