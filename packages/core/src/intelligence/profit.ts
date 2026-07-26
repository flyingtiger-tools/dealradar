import type { PriceEstimate, CostInputs, NetProfitResult } from "./types";

/**
 * Profit net = revente prudente − (achat + livraison + remise en état +
 * frais de plateforme + réserve de risque). Frais et réserve calculés en
 * proportion de la revente estimée, pas du prix d'achat.
 */
export function computeNetProfit(estimate: PriceEstimate, costs: CostInputs): NetProfitResult {
  const resaleBasisCents = estimate.conservativeCents;
  const platformFeeCents = Math.round(resaleBasisCents * costs.platformFeeRate);
  const riskReserveCents = Math.round(resaleBasisCents * costs.riskReserveRate);

  const totalCostCents =
    costs.purchasePriceCents +
    costs.shippingCostCents +
    costs.refurbCostCents +
    platformFeeCents +
    riskReserveCents;

  const netProfitCents = resaleBasisCents - totalCostCents;
  const marginRatio = costs.purchasePriceCents > 0 ? netProfitCents / costs.purchasePriceCents : 0;

  return {
    resaleBasisCents,
    platformFeeCents,
    riskReserveCents,
    totalCostCents,
    netProfitCents,
    marginRatio,
  };
}
