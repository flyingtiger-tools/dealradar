import * as Crypto from "expo-crypto";
import type { ResultViewModel } from "../screens/result/result-view-model";
import { buildProductKey } from "./product-key";
import type { HistoryEntry } from "./types";

/**
 * Mapping résultat -> candidat d'historique (LOT "beta product
 * readiness", Phase 12/23) — réutilise `ResultViewModel` (déjà le seul
 * mapper réel contrat -> vue, voir `screens/result/result-view-model.ts`)
 * plutôt que de relire `TcgCardAnalysisResult` une seconde fois : une
 * seule dérivation de la valeur marché (CHF natif ou converti), jamais
 * deux règles qui pourraient diverger.
 *
 * Retourne `null` quand le résultat ne doit jamais être historisé — un
 * résultat non identifié (`identityStatus !== "identified"`), une
 * fixture DEMO (Phase 49 : "zéro fixture en production"), ou une analyse
 * annulée/en erreur (qui n'atteint jamais cette fonction : voir Phase 14,
 * l'appelant ne construit un candidat qu'à partir d'un résultat réussi).
 */
export function buildHistoryCandidateFromResultViewModel(view: ResultViewModel, createdAt: string = new Date().toISOString()): Omit<HistoryEntry, "favorite"> | null {
  if (view.identityStatus !== "identified") return null;
  if (view.isDemo) return null;

  const chfAmountsCents = view.prices
    .map((price) => price.convertedAmountCents ?? (price.currency === "CHF" ? price.amountCents : null))
    .filter((amount): amount is number => amount !== null);

  const marketValue =
    chfAmountsCents.length > 0
      ? { low: Math.min(...chfAmountsCents) / 100, high: Math.max(...chfAmountsCents) / 100, currency: "CHF" }
      : null;

  const identity = { name: view.product.name, setName: view.product.setName, collectorNumber: view.product.collectorNumber, language: view.product.language, variant: view.product.variant };

  return {
    id: Crypto.randomUUID(),
    createdAt,
    category: view.category,
    identity,
    verdict: view.decision,
    marketValue,
    confidence: view.confidencePercent,
    source: view.prices[0]?.source ?? null,
    productKey: buildProductKey(view.category, identity),
  };
}
