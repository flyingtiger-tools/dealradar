import type { BrickLinkGuideType, BrickLinkPriceGuideResponse } from "./raw-types";
import type { EvidenceType } from "../market-intelligence/evidence-types";
import type { MarketObservation } from "../market-intelligence/market-observation";
import { MARKET_OBSERVATION_INGESTION_VERSION } from "../market-intelligence/market-observation";

/**
 * Décision de palier de preuve pour le Price Guide BrickLink (LOT
 * "Multi-Source Fusion + Source Wave 1") — DÉLIBÉRÉMENT CONSERVATRICE,
 * documentée ici car c'est exactement la décision demandée par le lot.
 *
 * `guide_type=sold` : le champ `data.price_detail[]` PEUT porter un
 * horodatage individuel par ligne selon la documentation publique
 * BrickLink, mais ceci N'EST PAS vérifié contre un appel réel (aucun
 * credential disponible cette session, voir `raw-types.ts`). Faute de
 * certitude sur la fiabilité d'un horodatage individuel, ce module ne
 * traite JAMAIS une ligne de `price_detail` du guide "sold" comme une
 * vente individuelle confirmée (Tier A) — il produit UNE SEULE observation
 * agrégée par appel, `evidenceType: "historicalPrices"`, **Tier B**
 * ("marché spécialisé, donnée calculée"), avec `soldAt: null` (aucun
 * horodatage de vente individuelle jamais inventé). C'est un choix
 * honnête, pas une lecture erronée de l'API — voir "Never infer individual
 * sold transaction timestamps if the API only returns aggregate
 * historical statistics" (instruction du lot).
 *
 * `guide_type=stock` : chaque ligne de `price_detail[]` représente une
 * annonce actuellement en vente — **Tier D** (`activeListings`), jamais A.
 */
function evidenceSemanticsFor(guideType: BrickLinkGuideType): { evidenceType: EvidenceType; tier: "B" | "D" } {
  return guideType === "sold" ? { evidenceType: "historicalPrices", tier: "B" } : { evidenceType: "activeListings", tier: "D" };
}

function parsePriceToCents(value: string | undefined): number | null {
  if (value === undefined) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export interface NormalizeBrickLinkContext {
  categorySlug: string;
  query: string;
  guideType: BrickLinkGuideType;
  collectedAt: string;
}

/**
 * Réponse Price Guide BrickLink -> UNE `MarketObservation` agrégée
 * (résumé min/max/qty conservé dans `rawMetadataRef` pour transparence,
 * jamais perdu). `null` si aucun prix moyen exploitable — jamais une
 * valeur inventée. Ne lève jamais.
 */
export function normalizeBrickLinkPriceGuide(response: BrickLinkPriceGuideResponse, context: NormalizeBrickLinkContext): MarketObservation | null {
  const data = response.data;
  if (!data?.item?.no || !data.currency_code) return null;

  // `qty_avg_price` (moyenne pondérée par quantité) est préféré à
  // `avg_price` (moyenne simple) quand disponible — plus représentatif du
  // marché réel, jamais une valeur inventée si absent (repli sur `avg_price`).
  const amountCents = parsePriceToCents(data.qty_avg_price) ?? parsePriceToCents(data.avg_price);
  if (amountCents === null) return null;

  const { evidenceType, tier } = evidenceSemanticsFor(context.guideType);
  const condition = data.new_or_used === "N" ? "new" : data.new_or_used === "U" ? "used" : null;

  return {
    source: "bricklink",
    // Un guide de prix n'a pas d'identifiant d'annonce individuelle — la
    // clé combine l'item + l'état + le type de guide pour rester stable
    // et dédoublonnable (voir `marketObservationDedupeKey`).
    sourceItemId: `${data.item.type ?? "ITEM"}:${data.item.no}:${data.new_or_used ?? "?"}:${context.guideType}`,
    sourceUrl: `https://www.bricklink.com/v2/catalog/catalogitem.page?${data.item.type ?? "P"}=${encodeURIComponent(data.item.no)}`,
    observedAt: context.collectedAt,
    productKey: null,
    query: context.query,
    title: `${data.item.type ?? "Item"} ${data.item.no}`,
    brand: "LEGO",
    model: data.item.no,
    variant: null,
    identifiers: { bricklinkNo: data.item.no },
    condition,
    completeness: null,
    priceAmountCents: amountCents,
    currency: data.currency_code,
    shippingCostCents: null,
    totalPriceCents: null,
    country: null,
    marketplace: "bricklink",
    evidenceType,
    evidenceTier: tier,
    // Jamais renseigné pour un agrégat — voir la note de décision de palier ci-dessus.
    soldAt: null,
    // Pas de recherche textuelle floue ici (lookup direct par référence d'article) — correspondance exacte par construction.
    matchScore: 1,
    rawMetadataRef: {
      minPrice: data.min_price,
      maxPrice: data.max_price,
      avgPrice: data.avg_price,
      qtyAvgPrice: data.qty_avg_price,
      unitQuantity: data.unit_quantity,
      totalQuantity: data.total_quantity,
      guideType: context.guideType,
    },
    ingestionVersion: MARKET_OBSERVATION_INGESTION_VERSION,
  };
}
