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
  /** Code brut ("A".."E") — jamais affiché tel quel, voir `strongestEvidenceLabel`. Conservé pour toute logique future qui en aurait besoin. */
  strongestEvidenceTier: string | null;
  /** Libellé déjà traduit ("Vente confirmée", "Annonce active"...) — la SEULE forme que l'UI doit afficher. `null` si `strongestEvidenceTier` est `null`. */
  strongestEvidenceLabel: string | null;
  /** Code brut ("up"/"down"/"flat"/"insufficient") — jamais affiché tel quel, voir `trendLabel`. `null` sans historique persisté exploitable pour ce produit. */
  trendDescriptor: string | null;
  /** Libellé déjà traduit, jamais une prédiction ("tendance récente à la hausse", jamais "va monter"). `null` si `trendDescriptor` est `null`. */
  trendLabel: string | null;
  trendConfidence: number | null;
  retailOnlyWarning: boolean;
  activeListingOnlyWarning: boolean;
  /**
   * Position (0–100) du prix D'ACHAT confirmé par l'utilisateur dans
   * l'historique connu (LOT "Interactive History...", section 1) — jamais
   * la position de la fourchette de valeur juste elle-même. `null` sans
   * historique exploitable. Code brut — jamais affiché tel quel (le mot
   * "percentile" est du jargon statistique), voir `currentVsHistoryLabel`.
   */
  currentVsHistoryPercentile: number | null;
  /** Libellé déjà traduit ("parmi les plus bas/élevés observés"...), jamais le mot "percentile" affiché à l'utilisateur. `null` si `currentVsHistoryPercentile` est `null`. */
  currentVsHistoryLabel: string | null;
  /** Libellés courts déjà traduits (jamais les codes `QualityFlag` bruts) — voir `QUALITY_FLAG_LABELS`. */
  qualityReasons: string[];
}

export interface ResultViewModel {
  identityStatus: ResultIdentityStatus;
  /** Catégorie réelle du résultat (LOT "Universal Object Valuation Foundation") — toujours `"pokemon_tcg"` pour `mapTcgResultToViewModel`, jamais devinée ailleurs (voir `history/from-result-view-model.ts`, qui en dépend pour ne plus historiser tout sous `pokemon_tcg`). */
  category: CategorySlug;
  /**
   * Clé produit canonique DÉJÀ RÉSOLUE côté serveur (LOT "Product History
   * UX + Source Health + Interactive Cancellation + Beta Readiness",
   * section 2) — voir `AnalysisResult.productKey` (`@dealradar/contracts`).
   * `null` pour tout flux TCG/RAF/historique/DEMO (jamais devinée côté
   * mobile) — seule `mapAnalysisResultToViewModel` la peuple réellement.
   * Détermine si le bouton "Voir l'historique" (`MarketInsightCard`) peut
   * s'afficher : jamais affiché sans une clé stable. Optionnel — même
   * raison que `marketInsight?` (ne jamais casser une fixture/un test
   * existant construisant un `ResultViewModel` littéral avant ce champ) ;
   * traité comme `null` quand absent.
   */
  productKey?: string | null;
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
  /**
   * Libellé d'affichage DÉJÀ traduit de `AnalysisResult.identityQuality`
   * (LOT "Live Identity Enrichment + Barcode-First + upc.dev Fallback +
   * Railway Readiness", section 12 — voir `identity-quality.ts`). Optionnel
   * pour ne casser aucune fixture/test existant ; `null`/absent = aucun
   * enrichissement catalogue tenté pour ce résultat (TCG, historique, RAF,
   * DEMO, ou résultat produit avant ce lot) — jamais un libellé deviné.
   */
  identityQualityLabel?: string | null;
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
      productKey: null,
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
    productKey: null,
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
