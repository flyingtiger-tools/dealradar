import type { ResultViewModel } from "../screens/result/result-view-model";
import type { HistoryEntry } from "./types";

/**
 * Reconstruit un `ResultViewModel` à partir d'une `HistoryEntry` (LOT
 * "beta product readiness", Phase 17) — permet à `ResultScreen` d'être
 * RÉUTILISÉ tel quel pour le détail d'un élément d'historique, jamais un
 * second écran de résultat dupliqué. Une `HistoryEntry` est une
 * projection SIMPLIFIÉE du résultat original (une seule fourchette de
 * prix, pas le détail par source) — cette fonction ne prétend jamais
 * reconstituer les données perdues (pas de fausse ligne "par source"), un
 * seul prix synthétique portant la source d'origine si connue.
 */
export function mapHistoryEntryToResultViewModel(entry: HistoryEntry): ResultViewModel {
  return {
    identityStatus: "identified",
    product: {
      name: entry.identity.name,
      setName: entry.identity.setName,
      collectorNumber: entry.identity.collectorNumber,
      language: entry.identity.language,
      variant: entry.identity.variant,
      productKind: null,
      gradingCompany: null,
      grade: null,
    },
    confidencePercent: entry.confidence,
    prices: entry.marketValue
      ? [
          {
            source: entry.source ?? "historique",
            amountCents: Math.round(entry.marketValue.low * 100),
            currency: entry.marketValue.currency,
            condition: null,
            updatedAt: entry.createdAt,
            convertedAmountCents: null,
            convertedCurrency: null,
          },
        ]
      : [],
    hasPricing: entry.marketValue !== null,
    warnings: [],
    reasonMessage: null,
    decision: entry.verdict,
    dealScore: null,
    reasons: [],
    isDemo: false,
  };
}
