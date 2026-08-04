import type { RafAnalysis } from "./types";

/**
 * Machine à états pure de l'écran de résultat bêta — même esprit que
 * `tcg-scan-state.ts`/`copilot-state.ts` : aucune dépendance réseau/caméra
 * ici, seulement des transitions testables en JS pur. L'écran pilote cette
 * machine, il ne la réimplémente jamais.
 */
export type BetaResultState =
  | { phase: "idle" }
  | { phase: "analyzing" }
  | { phase: "result"; analysis: RafAnalysis }
  | { phase: "error"; message: string };

export type BetaResultAction =
  | { type: "ANALYSIS_STARTED" }
  | { type: "ANALYSIS_SUCCEEDED"; analysis: RafAnalysis }
  | { type: "ANALYSIS_FAILED"; message: string }
  | { type: "RESET" };

export const initialBetaResultState: BetaResultState = { phase: "idle" };

export function betaResultReducer(state: BetaResultState, action: BetaResultAction): BetaResultState {
  switch (action.type) {
    case "ANALYSIS_STARTED":
      // Garde anti double-clic : une analyse déjà en cours ignore toute
      // nouvelle demande tant qu'elle n'a pas abouti (succès ou échec).
      if (state.phase === "analyzing") return state;
      return { phase: "analyzing" };
    case "ANALYSIS_SUCCEEDED":
      if (state.phase !== "analyzing") return state;
      return { phase: "result", analysis: action.analysis };
    case "ANALYSIS_FAILED":
      if (state.phase !== "analyzing") return state;
      return { phase: "error", message: action.message };
    case "RESET":
      return { phase: "idle" };
    default:
      return state;
  }
}
