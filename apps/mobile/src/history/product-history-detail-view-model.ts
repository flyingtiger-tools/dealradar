import type { ProductHistoryResponse } from "../api/product-history-client";

/**
 * Modèle de vue d'historique de prix PAR PRODUIT (LOT "Interactive History
 * + Generic Result UI + Full Cancellation + Pre-Prod Activation Package",
 * section 10) — prépare un futur graphique d'historique de prix SANS
 * construire cet écran ce lot (permission explicite : "not necessarily a
 * full screen yet"). Traduit `ProductHistoryResponse` (`api/product-
 * history-client.ts`) en une forme plate déjà prête à afficher — aucun
 * champ de décision/prédiction, aucune URL de source brute, jamais le mot
 * "percentile" (jargon statistique, voir `from-analysis-result-view-model.ts`
 * pour la même discipline de traduction).
 */
export interface ProductHistoryTrendSummaryViewModel {
  windowDays: 7 | 30 | 90 | 180;
  /** Libellé déjà traduit — voir `TREND_LABELS` (`screens/result/from-analysis-result-view-model.ts`), jamais le code brut affiché. */
  label: string;
  changePercent: number | null;
}

export interface ProductHistorySnapshotPointViewModel {
  cycleAt: string;
  fairCents: number | null;
  lowCents: number | null;
  highCents: number | null;
  currency: string;
}

export interface ProductHistoryDetailViewModel {
  productKey: string;
  asOf: string;
  sampleSize: number;
  medianCents: number | null;
  lowCents: number | null;
  highCents: number | null;
  trends: ProductHistoryTrendSummaryViewModel[];
  activeSupplyCount: number;
  sourceDiversity: number;
  /** 0–100, jamais une précision surestimée pour un historique peu profond (voir `computeHistoryConfidence`, `@dealradar/core`). */
  confidence: number;
  /** Résumés de cycle récents, du plus récent au plus ancien — jamais une source brute (déjà agrégés côté serveur). */
  snapshotPoints: ProductHistorySnapshotPointViewModel[];
  /** `true` uniquement si aucun point d'historique n'a été trouvé — jamais un graphique vide affiché comme "en cours de chargement". */
  isEmpty: boolean;
}

const TREND_LABELS: Record<string, string> = {
  up: "En hausse",
  down: "En baisse",
  flat: "Stable",
  insufficient: "Historique insuffisant",
};

export function toProductHistoryDetailViewModel(response: ProductHistoryResponse): ProductHistoryDetailViewModel {
  const { history } = response;
  return {
    productKey: history.productKey,
    asOf: history.asOf,
    sampleSize: history.history.sampleSize,
    medianCents: history.history.medianCents,
    lowCents: history.history.p25Cents,
    highCents: history.history.p75Cents,
    trends: history.history.trends.map((t) => ({
      windowDays: t.windowDays,
      label: TREND_LABELS[t.direction] ?? t.direction,
      changePercent: t.changePercent,
    })),
    activeSupplyCount: history.activeSupplyCount,
    sourceDiversity: history.sourceDiversity,
    confidence: history.history.confidence,
    snapshotPoints: history.recentSnapshotSummaries.map((s) => ({
      cycleAt: s.cycleAt,
      fairCents: s.fairCents,
      lowCents: s.lowCents,
      highCents: s.highCents,
      currency: s.currency,
    })),
    isEmpty: history.history.sampleSize === 0,
  };
}
