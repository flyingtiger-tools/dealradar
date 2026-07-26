import type { CostInputs } from "@dealradar/core";

/**
 * Hypothèses de coût par défaut pour le benchmark — mêmes valeurs
 * illustratives que `apps/workers/src/ingestion/ingest-and-analyze.ts`
 * (ADR 0008), pas des frais réels vérifiés. Le prix d'achat prospectif est
 * le prix affiché de chaque annonce du dataset.
 */
export const DEFAULT_COST_ASSUMPTIONS: Omit<CostInputs, "purchasePriceCents"> = {
  shippingCostCents: 0,
  platformFeeRate: 0.12,
  refurbCostCents: 0,
  riskReserveRate: 0.05,
};
