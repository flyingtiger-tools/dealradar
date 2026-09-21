/**
 * Formes brutes Keepa Product API (LOT "Source Wave 2") — voir
 * https://keepa.com/api-docs/product.html et l'énumération officielle
 * `CsvType` (`keepacom/api_backend`, `Product.java`). Keepa ne documente PAS
 * publiquement un mapping index -> nom sur sa page produit elle-même ; ce
 * fichier reprend l'énumération OFFICIELLE de leur propre backend
 * open-source (source de vérité la plus fiable disponible), pas une
 * supposition.
 *
 * AUCUN de ces indices ne représente une vente confirmée — chacun est un
 * point d'historique de PRIX (offre/prix affiché à un instant donné, tracké
 * par Keepa), jamais une transaction conclue. Voir `normalize.ts` pour la
 * décision de palier qui en découle (jamais A).
 */
export enum KeepaCsvType {
  AMAZON = 0,
  NEW = 1,
  USED = 2,
  SALES = 3,
  LISTPRICE = 4,
  COLLECTIBLE = 5,
  REFURBISHED = 6,
  NEW_FBM_SHIPPING = 7,
  LIGHTNING_DEAL = 8,
  WAREHOUSE = 9,
  NEW_FBA = 10,
  COUNT_NEW = 11,
  COUNT_USED = 12,
  COUNT_REFURBISHED = 13,
  COUNT_COLLECTIBLE = 14,
}

/**
 * Valeur-sentinelle documentée par la communauté Keepa (reprise du Python
 * client officieux le plus utilisé, cohérente avec le comportement observé
 * par de nombreux intégrateurs) : `-1` signifie "aucune offre disponible
 * pour cet intervalle", jamais un prix réel à zéro ou négatif.
 */
export const KEEPA_NO_DATA_SENTINEL = -1;

/** `[keepaTimeMinutes, valueCents, keepaTimeMinutes, valueCents, ...]` — une entrée alternée, jamais un objet structuré. */
export type KeepaCsvSeries = number[] | null;

export interface KeepaProduct {
  asin: string;
  title?: string;
  domainId: number;
  /** Codes produit alternatifs (UPC/EAN/GTIN/ISBN-13) si Keepa les connaît pour cet ASIN — absent si non résolu, jamais deviné. */
  eanList?: string[];
  upcList?: string[];
  /** Index = `KeepaCsvType`. `null` à un index = aucune donnée pour ce type de prix sur cet ASIN. */
  csv?: KeepaCsvSeries[];
}

export interface KeepaProductResponse {
  products?: KeepaProduct[];
  /** Présent en cas d'erreur (clé invalide, quota épuisé, ASIN inconnu) — jamais un produit vide silencieux. */
  error?: string;
  tokensLeft?: number;
}

/** `keepaTime` (minutes) -> epoch ms. Époque Keepa officielle : 2011-01-01T00:00:00Z. */
export const KEEPA_EPOCH_MS = Date.UTC(2011, 0, 1);
