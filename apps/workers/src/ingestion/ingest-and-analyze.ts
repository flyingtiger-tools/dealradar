import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceConnector } from "@dealradar/connectors";
import type { CostInputs } from "@dealradar/core";
import { runIngestion, analyzeListing } from "@dealradar/ingestion";
import { logger } from "../logger";

/**
 * Hypothèses de coût par défaut, documentées comme telles (ADR 0008) — pas
 * des frais eBay vérifiés. `shippingCostCents` par défaut à 0 : le coût de
 * livraison remonté par le connecteur n'est pas encore persisté sur
 * `listings` dans ce lot (limite documentée).
 */
const DEFAULT_COST_ASSUMPTIONS: Omit<CostInputs, "purchasePriceCents"> = {
  shippingCostCents: 0,
  platformFeeRate: 0.12,
  refurbCostCents: 0,
  riskReserveRate: 0.05,
};

export interface IngestAndAnalyzeResult {
  runId: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  analyzed: number;
}

/**
 * Enchaîne ingestion puis analyse Intelligence Core pour chaque annonce
 * touchée — satisfait "tester le flux réel" en un seul déclenchement. Le
 * prix d'achat prospectif est le prix affiché de l'annonce elle-même.
 */
export async function ingestAndAnalyze(params: {
  supabase: SupabaseClient;
  connector: MarketplaceConnector;
  sourceSlug: string;
  categorySlug: string;
  q: string;
}): Promise<IngestAndAnalyzeResult> {
  const summary = await runIngestion(params);
  const asOf = new Date().toISOString();
  let analyzed = 0;

  for (const listingId of summary.listingIds) {
    try {
      const { data: row } = await params.supabase
        .from("listings")
        .select("price_cents")
        .eq("id", listingId)
        .maybeSingle();
      const priceCents = (row as { price_cents: number } | null)?.price_cents ?? 0;

      await analyzeListing({
        supabase: params.supabase,
        listingId,
        costs: { purchasePriceCents: priceCents, ...DEFAULT_COST_ASSUMPTIONS },
        asOf,
      });
      analyzed += 1;
    } catch (error) {
      logger.warn(
        { listingId, error: error instanceof Error ? error.message : "erreur inconnue" },
        "Analyse Intelligence Core impossible pour cette annonce",
      );
    }
  }

  return {
    runId: summary.runId,
    fetched: summary.fetched,
    inserted: summary.inserted,
    updated: summary.updated,
    skipped: summary.skipped,
    failed: summary.failed,
    analyzed,
  };
}
