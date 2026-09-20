import type { NormalizedListing, NormalizedImage, ItemConditionRaw } from "../types";
import type { EbayRawItemSummary, EbayRawItem } from "./raw-types";
import { minimizeRawPayload } from "./redact";
import { normalizeEbayAspects } from "./attribute-mapping";

/**
 * Mapping condition eBay → condition DealRadar. Volontairement incomplet :
 * un libellé non reconnu retourne `null` plutôt qu'une supposition — jamais
 * de fausse précision sur l'état d'un objet.
 */
const CONDITION_MAP: Record<string, ItemConditionRaw> = {
  new: "new",
  "new other": "new",
  "new with tags": "new",
  "new without tags": "new",
  "certified - refurbished": "like_new",
  "excellent - refurbished": "like_new",
  "excellent refurbished": "like_new",
  "seller refurbished": "very_good",
  "very good - refurbished": "very_good",
  "very good": "very_good",
  "good - refurbished": "good",
  good: "good",
  used: "good",
  acceptable: "fair",
  "for parts or not working": "for_parts",
};

function mapCondition(raw: string | undefined): ItemConditionRaw {
  if (!raw) return null;
  return CONDITION_MAP[raw.trim().toLowerCase()] ?? null;
}

function toCents(value: string | undefined): number | null {
  if (value === undefined) return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/**
 * eBay Browse API brut → NormalizedListing. Un item sans identifiant, titre
 * ou prix exploitable est inutilisable : retourne `null` plutôt que de
 * fabriquer des valeurs. Tout le reste manquant devient `null`/`undefined`,
 * jamais une valeur inventée — cette fonction ne lève jamais.
 *
 * `attributes` fait maintenant correspondre les noms d'aspect eBay connus
 * (`localizedAspects`) aux clés de profil DealRadar (ex. "Set Number" eBay
 * -> `setNumber`) via `normalizeEbayAspects()` (LOT "Données marché réelles
 * + préparation E2E", résout la limite documentée depuis le LOT "Universal
 * Object Valuation Foundation", ADR 0008) — un aspect non reconnu reste
 * disponible sous son propre nom normalisé, jamais perdu ni forcé sur une
 * mauvaise clé.
 */
export function normalizeEbayItem(
  raw: EbayRawItemSummary | EbayRawItem,
  context: { categorySlug: string; collectedAt: string },
): NormalizedListing | null {
  const externalId = raw.itemId;
  const title = raw.title;
  const currency = raw.price?.currency;
  const amountCents = toCents(raw.price?.value);

  if (!externalId || !title || !currency || amountCents === null) return null;

  const images: NormalizedImage[] = [];
  if (raw.image?.imageUrl) images.push({ url: raw.image.imageUrl, position: 0 });
  (raw.additionalImages ?? []).forEach((img, i) => {
    if (img.imageUrl) images.push({ url: img.imageUrl, position: i + 1 });
  });

  const attributes = normalizeEbayAspects((raw as EbayRawItem).localizedAspects);

  return {
    meta: {
      source: "ebay",
      externalId,
      originalUrl: raw.itemWebUrl ?? `https://www.ebay.com/itm/${externalId}`,
      collectedAt: context.collectedAt,
      rawPayloadRef: minimizeRawPayload(raw, context.collectedAt),
    },
    title,
    description: raw.shortDescription ?? (raw as EbayRawItem).description,
    price: { amountCents, currency },
    shippingCostCents: toCents(raw.shippingOptions?.[0]?.shippingCost?.value),
    condition: mapCondition(raw.condition),
    categorySlug: context.categorySlug,
    attributes,
    location: {
      country: raw.itemLocation?.country ?? null,
      postalCode: raw.itemLocation?.postalCode ?? null,
      text: raw.itemLocation?.city ?? null,
    },
    images,
    seller: {
      externalId: null,
      username: raw.seller?.username ?? null,
      feedbackScore: raw.seller?.feedbackScore ?? null,
      feedbackPercentage:
        raw.seller?.feedbackPercentage !== undefined ? Number(raw.seller.feedbackPercentage) : null,
    },
    postedAt: raw.itemCreationDate ?? null,
  };
}
