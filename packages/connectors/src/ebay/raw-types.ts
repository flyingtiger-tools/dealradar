/**
 * Sous-ensemble typé des réponses eBay Browse API que nous consommons
 * réellement. Tous les champs sont optionnels : l'API peut en omettre
 * n'importe lequel selon la catégorie/l'annonce — normalize.ts ne doit
 * jamais présumer leur présence.
 */

export interface EbayRawMoney {
  value?: string;
  currency?: string;
}

export interface EbayRawImage {
  imageUrl?: string;
}

export interface EbayRawSeller {
  username?: string;
  feedbackPercentage?: string;
  feedbackScore?: number;
}

export interface EbayRawShippingOption {
  shippingCost?: EbayRawMoney;
}

export interface EbayRawItemLocation {
  country?: string;
  postalCode?: string;
  city?: string;
}

export interface EbayRawCategory {
  categoryId?: string;
  categoryName?: string;
}

export interface EbayRawAspect {
  name?: string;
  value?: string;
}

export interface EbayRawItemSummary {
  itemId?: string;
  title?: string;
  shortDescription?: string;
  price?: EbayRawMoney;
  itemWebUrl?: string;
  image?: EbayRawImage;
  additionalImages?: EbayRawImage[];
  condition?: string;
  conditionId?: string;
  seller?: EbayRawSeller;
  itemLocation?: EbayRawItemLocation;
  shippingOptions?: EbayRawShippingOption[];
  categories?: EbayRawCategory[];
  itemCreationDate?: string;
}

/** Réponse de `item_summary/search`. */
export interface EbayRawSearchResponse {
  total?: number;
  limit?: number;
  offset?: number;
  itemSummaries?: EbayRawItemSummary[];
}

/** Réponse de `item/{item_id}` — surperset de l'item summary. */
export interface EbayRawItem extends EbayRawItemSummary {
  description?: string;
  localizedAspects?: EbayRawAspect[];
}
