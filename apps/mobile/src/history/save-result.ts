import type { ResultViewModel } from "../screens/result/result-view-model";
import { buildHistoryCandidateFromResultViewModel } from "./from-result-view-model";
import { shouldAddToHistory } from "./policy";
import { addHistoryEntry, listHistory } from "./storage";
import type { HistoryEntry } from "./types";

/**
 * Cas d'usage "sauvegarder un résultat dans l'historique" (LOT "beta
 * product readiness", Phase 23) — combine mapping + politique + dépôt,
 * pour que `TcgScanScreen.tsx` reste un simple appelant, jamais le lieu
 * de cette logique (principe architectural du lot : UI / state /
 * persistence / mapping séparés).
 *
 * NE LÈVE JAMAIS : un échec de persistence locale ne doit jamais faire
 * disparaître un résultat déjà affiché à l'écran (Phase 23 : "si la
 * persistence locale échoue, NE PAS perdre le résultat"). L'appelant n'a
 * donc jamais besoin d'un `try/catch` autour de cet appel.
 *
 * Retourne l'entrée sauvegardée (pour brancher le bouton favori de
 * `ResultScreen` juste après un scan, Phase 20) — `null` si rien n'a été
 * sauvegardé (non identifié, fixture DEMO, doublon immédiat, ou échec de
 * persistence).
 */
export async function saveAnalysisResultToHistory(view: ResultViewModel): Promise<HistoryEntry | null> {
  try {
    const candidate = buildHistoryCandidateFromResultViewModel(view);
    if (!candidate) return null;

    const existing = await listHistory();
    if (!shouldAddToHistory(existing, candidate)) return null;

    const entry: HistoryEntry = { ...candidate, favorite: false };
    await addHistoryEntry(entry);
    return entry;
  } catch (error) {
    // Phase 23 : log interne uniquement ("HISTORY_SAVE_FAILED"), jamais
    // remonté à l'utilisateur ni ne jamais faire disparaître le résultat
    // déjà affiché — voir `TcgScanScreen.tsx`, cet appel n'est jamais dans
    // le chemin qui construit le rendu.
    console.warn("HISTORY_SAVE_FAILED", error instanceof Error ? error.message : String(error));
    return null;
  }
}
