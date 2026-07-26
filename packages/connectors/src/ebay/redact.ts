import type { EbayRawItemSummary, EbayRawItem } from "./raw-types";

/**
 * Liste blanche explicite : seuls ces champs de la réponse eBay sont
 * conservés comme `raw_payload` (traçabilité/debug). Tout le reste — y
 * compris toute donnée vendeur au-delà du nom d'utilisateur — est écarté
 * avant stockage. Aucun jeton/en-tête n'y figure de toute façon (c'est la
 * réponse eBay, pas notre requête), mais la garde-fou est explicite plutôt
 * qu'une confiance implicite dans le shape de l'API. Voir ADR 0008.
 */
export interface MinimizedRawPayload {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  condition?: string;
  conditionId?: string;
  categories?: { categoryId?: string; categoryName?: string }[];
  sellerUsername?: string;
  itemCreationDate?: string;
  collectedAt: string;
}

export function minimizeRawPayload(
  raw: EbayRawItemSummary | EbayRawItem,
  collectedAt: string,
): MinimizedRawPayload {
  return {
    itemId: raw.itemId,
    title: raw.title,
    price: raw.price ? { value: raw.price.value, currency: raw.price.currency } : undefined,
    condition: raw.condition,
    conditionId: raw.conditionId,
    categories: raw.categories?.map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName })),
    sellerUsername: raw.seller?.username,
    itemCreationDate: raw.itemCreationDate,
    collectedAt,
  };
}
