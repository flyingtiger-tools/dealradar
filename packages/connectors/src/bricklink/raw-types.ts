/**
 * Sous-ensemble typé de la réponse BrickLink API v3 "Price Guide"
 * (`GET /items/{type}/{no}/price`) que nous consommons — tous les champs
 * optionnels : l'API peut en omettre selon la disponibilité de données pour
 * cet article, `normalize.ts` ne doit jamais présumer leur présence.
 *
 * **Limite honnête, documentée explicitement (LOT "Multi-Source Fusion +
 * Source Wave 1")** : cette forme est reconstruite d'après la
 * documentation publique BrickLink API v3, JAMAIS vérifiée contre un appel
 * réel (aucun credential disponible cette session). Les noms de champs
 * exacts, en particulier la présence/absence d'un horodatage individuel
 * par ligne dans `price_detail`, doivent être reconfirmés contre la
 * documentation officielle à jour avant tout usage avec des identifiants
 * réels — voir `normalize.ts` pour la décision de palier de preuve qui en
 * découle, délibérément conservatrice tant que ce n'est pas vérifié.
 */

export type BrickLinkGuideType = "sold" | "stock";
export type BrickLinkNewOrUsed = "N" | "U";

export interface BrickLinkPriceDetailEntry {
  quantity?: number;
  unit_price?: string;
  shipping_available?: boolean;
  seller_country_code?: string;
  buyer_country_code?: string;
  /**
   * Présent uniquement si BrickLink restitue un horodatage individuel par
   * ligne (statut NON confirmé sans appel réel, voir l'en-tête du fichier)
   * — `normalize.ts` ne l'utilise JAMAIS pour renseigner `soldAt` tant que
   * cette incertitude n'est pas levée, même si le champ est présent.
   */
  date_ordered?: string;
}

export interface BrickLinkPriceGuideData {
  item?: { no?: string; type?: string };
  new_or_used?: BrickLinkNewOrUsed;
  currency_code?: string;
  min_price?: string;
  max_price?: string;
  avg_price?: string;
  qty_avg_price?: string;
  unit_quantity?: number;
  total_quantity?: number;
  price_detail?: BrickLinkPriceDetailEntry[];
}

export interface BrickLinkMeta {
  code?: number;
  message?: string;
  description?: string;
}

export interface BrickLinkPriceGuideResponse {
  meta?: BrickLinkMeta;
  data?: BrickLinkPriceGuideData;
}
