import type { HistoryEntry } from "./types";

/**
 * Politique "faut-il historiser cette analyse ?" (LOT "beta product
 * readiness", Phase 14) — pure, testable, séparée du dépôt
 * (`history/storage.ts` reste un CRUD simple qui ne prend aucune
 * décision). Le CALLER (écran de scan) décide déjà, structurellement, de
 * n'appeler cette politique que sur un résultat RÉUSSI (identifié, avec
 * ou sans prix) — une annulation, une requête malformée ou un échec
 * réseau ne produisent jamais de `HistoryEntry` candidat, ils ne passent
 * même pas par cette fonction.
 *
 * Fenêtre anti-doublon immédiat : une même clé produit répétée dans les
 * `IMMEDIATE_DUPLICATE_WINDOW_MS` qui suivent l'entrée la plus récente est
 * considérée comme une soumission accidentelle (ex. double-tap qui aurait
 * échappé à la protection UI, ou un nouveau scan immédiat de la même
 * carte par erreur) — jamais un blocage permanent : la MÊME carte
 * rescannée plus tard reste historisée normalement.
 */
export const IMMEDIATE_DUPLICATE_WINDOW_MS = 60_000;

export interface HistoryCandidate {
  productKey: string;
  createdAt: string;
}

export function isImmediateDuplicate(existingEntries: readonly HistoryEntry[], candidate: HistoryCandidate): boolean {
  const mostRecentSameKey = existingEntries
    .filter((entry) => entry.productKey === candidate.productKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!mostRecentSameKey) return false;

  const candidateTime = Date.parse(candidate.createdAt);
  const previousTime = Date.parse(mostRecentSameKey.createdAt);
  if (Number.isNaN(candidateTime) || Number.isNaN(previousTime)) return false;

  return candidateTime - previousTime < IMMEDIATE_DUPLICATE_WINDOW_MS;
}

/**
 * Point d'entrée unique (Phase 14) — `true` si cette analyse doit devenir
 * une `HistoryEntry`. Aujourd'hui, la seule règle est l'anti-doublon
 * immédiat ci-dessus : toute analyse qui atteint cette fonction est déjà,
 * par construction de l'appelant, un résultat réussi (identifié, prix ou
 * non) — jamais une annulation/un échec réseau/une requête malformée.
 */
export function shouldAddToHistory(existingEntries: readonly HistoryEntry[], candidate: HistoryCandidate): boolean {
  return !isImmediateDuplicate(existingEntries, candidate);
}
