import type { PriceEstimate, CostInputs, NetProfitResult } from "./types";

/**
 * Profit net = revente prudente − (achat + livraison + remise en état +
 * frais de plateforme + réserve de risque). Frais et réserve calculés en
 * proportion de la revente estimée, pas du prix d'achat.
 *
 * `costs.purchasePriceCents === null` (prix d'achat non confirmé) -> `null`
 * plutôt qu'un profit calculé sur un coût fabriqué (jamais 0, qui gonflerait
 * artificiellement le profit et pourrait produire un faux signal BUY).
 */
export function computeNetProfit(estimate: PriceEstimate, costs: CostInputs): NetProfitResult | null {
  if (costs.purchasePriceCents === null) return null;
  const purchasePriceCents = costs.purchasePriceCents;

  const resaleBasisCents = estimate.conservativeCents;
  const platformFeeCents = Math.round(resaleBasisCents * costs.platformFeeRate);
  const riskReserveCents = Math.round(resaleBasisCents * costs.riskReserveRate);

  const totalCostCents =
    purchasePriceCents +
    costs.shippingCostCents +
    costs.refurbCostCents +
    platformFeeCents +
    riskReserveCents;

  const netProfitCents = resaleBasisCents - totalCostCents;
  const marginRatio = purchasePriceCents > 0 ? netProfitCents / purchasePriceCents : 0;

  return {
    resaleBasisCents,
    platformFeeCents,
    riskReserveCents,
    totalCostCents,
    netProfitCents,
    marginRatio,
  };
}
