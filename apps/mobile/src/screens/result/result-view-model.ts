import type { CategorySlug, TcgCardAnalysisResult } from "@dealradar/contracts";
import type { BusinessDecision } from "../../theme/raf-mapping";
import { cleanUserMessage } from "../../identification/user-messages";
import { toConfidencePercent } from "../../format/confidence";

/**
 * Modèle d'affichage de l'écran de résultat (Phase 8) — découplé du
 * contrat réseau (`TcgCardAnalysisResult`) pour que `ResultScreen` reste
 * testable et réutilisable par les fixtures DEMO (Phase 16) sans jamais
 * dépendre du réseau. Un seul mapper réel (`mapTcgResultToViewModel`) fait
 * la traduction contrat -> vue ; aucun écran ne doit lire les champs bruts
 * de `TcgCardAnalysisResult` directement.
 */

export interface ResultPriceRow {
  source: string;
  amountCents: number;
  currency: string;
  condition: string | null;
  updatedAt: string | null;
  convertedAmountCents: number | null;
  convertedCurrency: string | null;
}

export type ResultIdentityStatus = "identified" | "insufficient_data" | "failed";

/**
 * Résumé honnête de la preuve de marché multi-source (LOT "Data Quality
 * Calibration + Operator Observability + Mobile Market Insight Contract",
 * section 10) — traduit `AnalysisResult.marketEvidence` (`@dealradar/
 * contracts`) en quelques champs concis et déjà prêts à afficher, jamais un
 * diagnostic technique brut (aucun flag de qualité cru, `qualityReasons`
 * porte déjà des libellés courts en français — voir
 * `from-analysis-result-view-model.ts`). `null` pour tout flux qui ne
 * produit pas de `marketEvidence` (TCG, historique, RAF, DEMO) — jamais une
 * valeur devinée pour ces flux.
 */
export interface ResultMarketInsight {
  fairValueLowCents: number | null;
  fairValueHighCents: number | null;
  currency: string | null;
  confidencePercent: number | null;
  sourceCount: number | null;
  strongestEvidenceTier: string | null;
  /** `null` tant qu'aucun contexte d'historique n'a été fourni à la fusion — voir le commentaire dans `process-analysis.ts`. */
  trendDescriptor: string | null;
  trendConfidence: number | null;
  retailOnlyWarning: boolean;
  activeListingOnlyWarning: boolean;
  /** Libellés courts déjà traduits (jamais les codes `QualityFlag` bruts) — voir `QUALITY_FLAG_LABELS`. */
  qualityReasons: string[];
}

export interface ResultViewModel {
  identityStatus: ResultIdentityStatus;
  /** Catégorie réelle du résultat (LOT "Universal Object Valuation Foundation") — toujours `"pokemon_tcg"` pour `mapTcgResultToViewModel`, jamais devinée ailleurs (voir `history/from-result-view-model.ts`, qui en dépend pour ne plus historiser tout sous `pokemon_tcg`). */
  category: CategorySlug;
  product: {
    name: string | null;
    setName: string | null;
    collectorNumber: string | null;
    language: string | null;
    variant: string | null;
    productKind: string | null;
    gradingCompany: string | null;
    grade: string | null;
  };
  /** 0-100, dérivé de `identity.confidence` (0-1) — jamais mélangé avec `dealScore` (Phase 9). */
  confidencePercent: number | null;
  prices: ResultPriceRow[];
  hasPricing: boolean;
  warnings: string[];
  reasonMessage: string | null;
  /**
   * `decision`/`dealScore`/`reasons` : `null`/`[]` pour tout résultat TCG
   * réel aujourd'hui — ce flux ne produit aucune décision BUY/REVIEW/PASS
   * (voir `identification/types.ts`, `RafAnalysis.decision`). Présents dans
   * le modèle uniquement pour que `VerdictBanner`/`ScoreConfidenceRow`
   * puissent s'afficher plus tard sans changer la forme du modèle, jamais
   * pour être remplis avec une valeur inventée ici.
   */
  decision: BusinessDecision | null;
  dealScore: number | null;
  reasons: string[];
  /** `true` uniquement pour les fixtures de `fixtures/demo-results.ts` — jamais pour un résultat réel (voir tests d'isolation). */
  isDemo: boolean;
  /** Optionnel pour ne casser aucune fixture/test existant construisant un `ResultViewModel` littéral avant ce champ — traité comme `null` quand absent. Voir `ResultMarketInsight`. */
  marketInsight?: ResultMarketInsight | null;
}

export type TcgResultStatus = "completed" | "insufficient_data" | "failed";

/**
 * Seul mapper réel contrat -> vue pour le scan carte TCG. Réutilise
 * exactement la règle déjà établie dans `TcgScanScreen.tsx`
 * (`TcgScanResultView`) : le signal de vérité est `result.identity`, jamais
 * `status` seul (une carte identifiée sans prix exact reste
 * `identityStatus: "identified"`, jamais un échec — Phase 19/Priorité 10).
 */
export function mapTcgResultToViewModel(result: TcgCardAnalysisResult | null, status: TcgResultStatus): ResultViewModel {
  if (!result || !result.identity) {
    return {
      identityStatus: status === "failed" ? "failed" : "insufficient_data",
      category: "pokemon_tcg",
      product: { name: null, setName: null, collectorNumber: null, language: null, variant: null, productKind: null, gradingCompany: null, grade: null },
      confidencePercent: null,
      prices: [],
      hasPricing: false,
      warnings: result?.warnings ?? [],
      reasonMessage: cleanUserMessage(result?.reason ?? null) ?? (status === "failed" ? "Identification impossible avec les informations disponibles." : null),
      decision: null,
      dealScore: null,
      reasons: [],
      isDemo: false,
      marketInsight: null,
    };
  }

  const { identity, priceObservations } = result;
  return {
    identityStatus: "identified",
    category: "pokemon_tcg",
    product: {
      name: identity.name,
      setName: identity.setName,
      collectorNumber: identity.cardNumber,
      language: identity.language,
      variant: identity.variant,
      productKind: identity.productKind,
      gradingCompany: identity.gradingCompany,
      grade: identity.grade,
    },
    confidencePercent: toConfidencePercent(identity.confidence),
    prices: priceObservations.map((obs) => ({
      source: obs.source,
      amountCents: obs.amountCents,
      currency: obs.currency,
      condition: obs.condition,
      updatedAt: obs.updatedAt,
      convertedAmountCents: obs.conversion?.convertedAmountCents ?? null,
      convertedCurrency: obs.conversion?.convertedCurrency ?? null,
    })),
    hasPricing: priceObservations.length > 0,
    warnings: result.warnings,
    reasonMessage: null,
    decision: null,
    dealScore: null,
    reasons: [],
    isDemo: false,
    marketInsight: null,
  };
}
