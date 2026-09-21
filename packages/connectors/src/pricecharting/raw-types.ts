/**
 * Sous-ensemble typé de la réponse PriceCharting API "Product" que nous
 * consommons — tous les champs sont optionnels, `normalize.ts` ne doit
 * jamais présumer leur présence. Les prix sont déjà en CENTIMES (entiers)
 * selon la documentation publique PriceCharting — aucune conversion
 * décimale nécessaire, contrairement à SerpApi/BrickLink.
 *
 * **Limite honnête** : forme reconstruite d'après la documentation
 * publique, jamais vérifiée contre un appel réel (`PRICECHARTING_TOKEN`
 * absent cette session — voir `connector.ts`).
 */
export interface PriceChartingProduct {
  id?: string;
  "product-name"?: string;
  "console-name"?: string;
  /** Article seul, sans boîte ni manuel — CENTIMES. */
  "loose-price"?: number;
  /** "Complete in box" — CENTIMES. */
  "cib-price"?: number;
  /** Neuf scellé — CENTIMES. */
  "new-price"?: number;
  /** Gradé (ex. WATA/VGA pour le jeu vidéo) — CENTIMES. */
  "graded-price"?: number;
  "box-only-price"?: number;
  "manual-only-price"?: number;
  "release-date"?: string;
}

export interface PriceChartingErrorResponse {
  status?: string;
  "error-message"?: string;
}

export type PriceChartingProductResponse = PriceChartingProduct & PriceChartingErrorResponse;
