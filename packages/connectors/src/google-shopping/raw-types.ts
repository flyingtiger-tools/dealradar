/**
 * Sous-ensemble typé de la réponse SerpApi "Google Shopping" que nous
 * consommons réellement (`engine=google_shopping`). Tous les champs sont
 * optionnels : SerpApi peut en omettre n'importe lequel selon le produit/
 * marchand — `normalize.ts` ne doit jamais présumer leur présence, même
 * discipline que `ebay/raw-types.ts`.
 */

export interface SerpApiShoppingResult {
  position?: number;
  title?: string;
  product_id?: string;
  product_link?: string;
  link?: string;
  source?: string;
  /** Prix affiché tel quel par SerpApi, ex. "CHF 129.00" — jamais utilisé directement, voir `extracted_price`. */
  price?: string;
  /** Valeur numérique déjà extraite par SerpApi — source de vérité pour le montant, `price` reste uniquement pour affichage/diagnostic. */
  extracted_price?: number;
  old_price?: string;
  extracted_old_price?: number;
  /** Présent uniquement si le marchand affiche l'article comme d'occasion — jamais déduit autrement. */
  second_hand_condition?: string;
  delivery?: string;
  thumbnail?: string;
  rating?: number;
  reviews?: number;
}

export interface SerpApiSearchParameters {
  q?: string;
  location?: string;
  google_domain?: string;
  gl?: string;
  hl?: string;
}

export interface SerpApiSearchMetadata {
  status?: string;
  created_at?: string;
}

export interface SerpApiGoogleShoppingResponse {
  search_metadata?: SerpApiSearchMetadata;
  search_parameters?: SerpApiSearchParameters;
  shopping_results?: SerpApiShoppingResult[];
  error?: string;
}
