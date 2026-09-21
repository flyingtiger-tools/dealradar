import type { SerpApiGoogleShoppingResponse, SerpApiShoppingResult } from "./raw-types";
import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";
import { defaultTierForEvidenceType } from "../market-intelligence/evidence-tiers";

/**
 * Devise déduite du PAYS ciblé par la requête (`gl`), jamais du symbole
 * dans la chaîne `price` de SerpApi (ex. "$" est ambigu entre USD/CAD/AUD
 * — trop fragile pour en dépendre). Volontairement une liste FERMÉE des
 * marchés que DealRadar cible aujourd'hui — un pays absent retourne
 * `null`, jamais une devise devinée.
 */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  ch: "CHF",
  us: "USD",
  fr: "EUR",
  de: "EUR",
  it: "EUR",
  gb: "GBP",
};

export function currencyForCountry(country: string | undefined): string | null {
  if (!country) return null;
  return COUNTRY_TO_CURRENCY[country.toLowerCase()] ?? null;
}

/**
 * Un résultat Google Shopping est TOUJOURS une preuve `retailPrices`
 * (palier E) OU, quand `second_hand_condition` est présent, une annonce
 * active de seconde main (`activeListings`, palier D) — jamais
 * `soldTransactions` : Google Shopping n'expose aucune vente conclue,
 * seulement des prix affichés par des marchands à l'instant de la requête
 * (voir ADR 0008, même discipline que pour eBay).
 */
function evidenceTypeFor(result: SerpApiShoppingResult): "activeListings" | "retailPrices" {
  return result.second_hand_condition ? "activeListings" : "retailPrices";
}

export interface NormalizeGoogleShoppingContext {
  categorySlug: string;
  query: string;
  country: string | undefined;
  collectedAt: string;
}

/**
 * `SerpApiShoppingResult` brut -> `MarketObservation`. Un résultat sans
 * identifiant, titre ou prix exploitable est inutilisable : retourne
 * `null` plutôt que de fabriquer une valeur (même règle que
 * `ebay/normalize.ts`). Ne lève jamais.
 */
export function normalizeSerpApiShoppingResult(
  result: SerpApiShoppingResult,
  context: NormalizeGoogleShoppingContext,
): MarketObservation | null {
  const title = result.title;
  const sourceItemId = result.product_id ?? result.product_link ?? result.link;
  const amount = result.extracted_price;
  const currency = currencyForCountry(context.country);

  if (!title || !sourceItemId || amount === undefined || currency === null) return null;

  const evidenceType = evidenceTypeFor(result);

  return {
    source: "google_shopping",
    sourceItemId,
    sourceUrl: result.product_link ?? result.link ?? null,
    observedAt: context.collectedAt,
    productKey: null,
    query: context.query,
    title,
    brand: null,
    model: null,
    variant: null,
    identifiers: {},
    condition: result.second_hand_condition ?? null,
    completeness: null,
    priceAmountCents: Math.round(amount * 100),
    currency,
    shippingCostCents: null,
    totalPriceCents: null,
    country: context.country?.toUpperCase() ?? null,
    marketplace: result.source ?? "google_shopping",
    evidenceType,
    evidenceTier: defaultTierForEvidenceType(evidenceType),
    // Google Shopping ne confirme jamais de vente — voir la note au-dessus d'`evidenceTypeFor`.
    soldAt: null,
    // Aucun score de correspondance calculable sans identité résolue côté DealRadar à ce stade — 1 par défaut (résultat déjà filtré par la requête textuelle envoyée), jamais 0 qui suggérerait une non-correspondance.
    matchScore: 1,
    rawMetadataRef: { position: result.position, thumbnail: result.thumbnail },
    ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
  };
}

export function normalizeSerpApiGoogleShoppingResponse(
  response: SerpApiGoogleShoppingResponse,
  context: NormalizeGoogleShoppingContext,
): MarketObservation[] {
  return (response.shopping_results ?? [])
    .map((result) => normalizeSerpApiShoppingResult(result, context))
    .filter((obs): obs is MarketObservation => obs !== null);
}
