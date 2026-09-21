import type { CategorySlug } from "@dealradar/contracts";
import type { RafAnalysis } from "../../identification/types";
import type { BusinessDecision } from "../../theme/raf-mapping";
import type { ResultViewModel, ResultPriceRow } from "./result-view-model";

/**
 * Mapper `RafAnalysis` (contrat aplati produit par `identifyCapture()` +
 * `CategoryAdapter.analyze()`, `identification/types.ts`) → `ResultViewModel`
 * — LOT "rendre le scan universel accessible dans l'app". Permet à
 * `UniversalScanScreen` de réutiliser `ResultScreen` tel quel (jamais un
 * second écran de résultat), exactement comme `mapTcgResultToViewModel`/
 * `mapAnalysisResultToViewModel` le font déjà pour les contrats réseau bruts.
 *
 * `RafAnalysis` ne porte qu'une fourchette basse/haute unique (pas de
 * détail par source comme `TcgCardAnalysisResult.priceObservations`) — une
 * seule ligne de prix (ou deux si basse ≠ haute), jamais un détail par
 * source inventé qui n'existe pas dans ce contrat aplati.
 */

const BUSINESS_DECISIONS: readonly BusinessDecision[] = ["BUY", "REVIEW", "PASS", "INSUFFICIENT_DATA"];

function toBusinessDecision(decision: string | null): BusinessDecision | null {
  if (decision === null) return null;
  return (BUSINESS_DECISIONS as readonly string[]).includes(decision) ? (decision as BusinessDecision) : null;
}

function buildPriceRows(analysis: RafAnalysis): ResultPriceRow[] {
  const { low, high, currency } = analysis.valuation;
  if (low === null || high === null || currency === null) return [];
  const source = analysis.evidence[0] ?? "estimated_value";
  const row = (amount: number): ResultPriceRow => ({
    source,
    amountCents: Math.round(amount * 100),
    currency,
    condition: null,
    updatedAt: null,
    convertedAmountCents: null,
    convertedCurrency: null,
  });
  return low === high ? [row(low)] : [row(low), row(high)];
}

/**
 * Signal de vérité = `product.name`, même discipline que les autres
 * mappers (`result-view-model.ts`, `from-analysis-result-view-model.ts`) —
 * jamais `status` seul. `status: "needs_confirmation"` n'est aujourd'hui
 * produit par AUCUN adaptateur générique (seul `tcgAdapter` peut le
 * produire, jamais routé vers ce mapper — voir `UniversalScanScreen.tsx`,
 * qui n'utilise que `genericObjectAdapters`) : traité ici par défense
 * uniquement, jamais comme un cas réel attendu.
 */
export function mapRafAnalysisToViewModel(analysis: RafAnalysis, fallbackCategory: CategorySlug): ResultViewModel {
  const category = analysis.category ?? fallbackCategory;

  if (!analysis.product.name) {
    const identityStatus = analysis.status === "failed" ? "failed" : "insufficient_data";
    return {
      identityStatus,
      category,
      product: { name: null, setName: null, collectorNumber: null, language: null, variant: null, productKind: null, gradingCompany: null, grade: null },
      confidencePercent: null,
      prices: [],
      hasPricing: false,
      warnings: analysis.risks,
      reasonMessage: analysis.risks[0] ?? (identityStatus === "failed" ? "Identification impossible avec les informations disponibles." : null),
      decision: null,
      dealScore: null,
      reasons: [],
      isDemo: false,
      marketInsight: null,
    };
  }

  return {
    identityStatus: "identified",
    category,
    product: {
      name: analysis.product.name,
      setName: analysis.product.setName,
      collectorNumber: analysis.product.collectorNumber,
      language: analysis.product.language,
      variant: null,
      productKind: null,
      gradingCompany: null,
      grade: null,
    },
    confidencePercent: analysis.confidence !== null ? Math.round(analysis.confidence * 100) : null,
    prices: buildPriceRows(analysis),
    hasPricing: analysis.valuation.low !== null,
    warnings: analysis.risks,
    reasonMessage: null,
    decision: toBusinessDecision(analysis.decision),
    dealScore: analysis.dealScore,
    reasons: [],
    isDemo: false,
    marketInsight: null,
  };
}
