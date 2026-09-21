/**
 * Formes brutes DataForSEO Merchant API — Google Shopping Products (LOT
 * "Source Wave 3", section 2). Voir https://docs.dataforseo.com/v3/
 * merchant-google-products-task_post/ et .../task_get-advanced/.
 *
 * Contrairement à SerpApi (`google-shopping/`), cette API n'a AUCUN
 * endpoint synchrone pour la recherche de produits — uniquement un modèle
 * de tâche asynchrone (POST pour créer, GET pour lire une fois prête).
 * Voir `client.ts` pour la stratégie d'attente bornée qui en découle.
 */

export interface DataForSeoTaskPostRequestItem {
  keyword: string;
  location_code: number;
  language_code: string;
  depth?: number;
  price_min?: number;
  price_max?: number;
}

export interface DataForSeoTaskPostResponseTask {
  id: string;
  status_code: number;
  status_message: string;
  cost?: number;
}

export interface DataForSeoTaskPostResponse {
  status_code: number;
  status_message: string;
  tasks?: DataForSeoTaskPostResponseTask[];
}

/**
 * Aucun champ `condition`/`second_hand` n'est documenté sur ce endpoint —
 * contrairement à SerpApi (`second_hand_condition`) ; voir `normalize.ts`
 * pour la conséquence honnête (jamais palier D deviné faute de signal).
 */
export interface DataForSeoShoppingItem {
  type?: string;
  title?: string;
  price?: number;
  currency?: string;
  seller?: string;
  domain?: string;
  product_id?: string;
  gid?: string;
  shopping_url?: string;
  rank_absolute?: number;
}

export interface DataForSeoTaskResult {
  keyword?: string;
  items?: DataForSeoShoppingItem[];
}

export interface DataForSeoTaskGetResponseTask {
  id: string;
  status_code: number;
  status_message: string;
  /** `null` tant que la tâche n'est pas prête — voir `client.ts`. */
  result: DataForSeoTaskResult[] | null;
}

export interface DataForSeoTaskGetResponse {
  status_code: number;
  status_message: string;
  tasks?: DataForSeoTaskGetResponseTask[];
}
