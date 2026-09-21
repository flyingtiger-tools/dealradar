import type { PriceChartingProductResponse } from "./raw-types";
import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";

/**
 * Chaque champ de prix PriceCharting (`loose-price`/`cib-price`/
 * `new-price`/`graded-price`) est une VALEUR DE MARCHÉ CALCULÉE par
 * PriceCharting à partir de son propre historique de ventes agrégé —
 * jamais une transaction individuelle confirmée. **Tier B** ("marché
 * spécialisé, donnée calculée") pour chacune, jamais A, exactement comme
 * demandé par le lot ("classify as Tier B ... unless the API explicitly
 * returns confirmed transaction data" — ce n'est pas le cas ici).
 */
type PriceChartingPriceField = "loose-price" | "cib-price" | "new-price" | "graded-price";

const PRICE_FIELD_TO_COMPLETENESS: Record<string, { field: PriceChartingPriceField; completeness: string; condition: string | null }> = {
  loose: { field: "loose-price", completeness: "loose", condition: null },
  cib: { field: "cib-price", completeness: "complete_in_box", condition: null },
  new: { field: "new-price", completeness: "sealed", condition: "new" },
  graded: { field: "graded-price", completeness: "graded", condition: null },
};

export interface NormalizePriceChartingContext {
  categorySlug: string;
  query: string;
  collectedAt: string;
}

/**
 * Un produit PriceCharting -> jusqu'à 4 `MarketObservation` (une par
 * variante loose/CIB/neuf/gradée réellement présente dans la réponse) —
 * jamais une seule moyenne qui masquerait ces états très différents en
 * valeur. Un champ de prix absent ne produit simplement aucune observation
 * pour cette variante, jamais un prix inventé.
 */
export function normalizePriceChartingProduct(response: PriceChartingProductResponse, context: NormalizePriceChartingContext): MarketObservation[] {
  if (!response.id || response.status === "error") return [];
  const title = [response["product-name"], response["console-name"]].filter(Boolean).join(" — ") || response.id;

  const observations: MarketObservation[] = [];
  for (const { field, completeness, condition } of Object.values(PRICE_FIELD_TO_COMPLETENESS)) {
    const cents = response[field];
    if (cents === undefined || cents === null || !Number.isFinite(cents)) continue;

    observations.push({
      source: "pricecharting",
      sourceItemId: `${response.id}:${completeness}`,
      sourceUrl: `https://www.pricecharting.com/game/${encodeURIComponent(response.id)}`,
      observedAt: context.collectedAt,
      productKey: null,
      query: context.query,
      title,
      brand: null,
      model: null,
      variant: null,
      identifiers: { priceChartingId: response.id },
      condition,
      completeness,
      priceAmountCents: cents,
      // PriceCharting cote toujours en USD (marché américain) — jamais présenté comme une autre devise.
      currency: "USD",
      shippingCostCents: null,
      totalPriceCents: null,
      country: "US",
      marketplace: "pricecharting",
      evidenceType: "historicalPrices",
      evidenceTier: "B",
      soldAt: null,
      matchScore: 1,
      rawMetadataRef: { releaseDate: response["release-date"] },
      ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
    });
  }

  return observations;
}
