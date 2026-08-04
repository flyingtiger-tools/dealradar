import type { CategorySlug } from "@dealradar/contracts";
import type { UniversalCaptureResult } from "../capture/types";
import type { AuthContext, CategoryAdapter, RafAnalysis } from "./types";
import { failedAnalysis, insufficientDataAnalysis } from "./raf-analysis-helpers";

/**
 * Orchestrateur minimal (ADR 0013, étape « TCG Adapter minimal ») —
 * route une capture universelle vers le `CategoryAdapter` dont
 * `canHandle()` revendique la plus haute confiance, jamais un appel IA ici
 * (le recours IA, s'il a lieu, vit entièrement dans le pipeline backend
 * déjà existant, appelé par l'adaptateur). Aucune connaissance d'une
 * catégorie précise dans ce fichier.
 */
export async function identifyCapture(
  capture: UniversalCaptureResult,
  categoryHint: CategorySlug | null,
  auth: AuthContext,
  adapters: readonly CategoryAdapter[],
): Promise<RafAnalysis> {
  const candidates = adapters
    .map((adapter) => ({ adapter, candidate: adapter.canHandle(capture, categoryHint) }))
    .filter((entry) => entry.candidate.category !== null && entry.candidate.confidence > 0);

  if (candidates.length === 0) {
    const missingFields = adapters.flatMap((adapter) => adapter.canHandle(capture, categoryHint).missingFields);
    return insufficientDataAnalysis(Array.from(new Set(missingFields)));
  }

  const best = candidates.reduce((a, b) => (b.candidate.confidence > a.candidate.confidence ? b : a));

  try {
    return await best.adapter.analyze(capture, auth);
  } catch (e) {
    // Filet de sécurité : un `CategoryAdapter` correct ne devrait jamais lever
    // (voir `CategoryAdapter.analyze`), mais l'orchestrateur ne doit jamais
    // planter l'écran appelant si un adaptateur le fait quand même.
    return failedAnalysis(best.candidate.category, e instanceof Error ? e.message : "Erreur inconnue lors de l'identification.");
  }
}
