import type { UniversalCaptureResult } from "../capture/types";
import type { AnalysisProgressPhase, RafAnalysis } from "./types";

/**
 * Machine à états pure de l'écran de résultat bêta — même esprit que
 * `tcg-scan-state.ts`/`copilot-state.ts` : aucune dépendance réseau/caméra
 * ici, seulement des transitions testables en JS pur. L'écran pilote cette
 * machine, il ne la réimplémente jamais.
 *
 * "preview" est l'étape de confirmation obligatoire (ADR 0013) : une photo
 * capturée n'atteint jamais "uploading" sans passer par une action
 * `ANALYSIS_STARTED` explicite — jamais automatique après la capture.
 */
export type BetaResultState =
  | { phase: "idle" }
  | { phase: "preview"; capture: UniversalCaptureResult }
  | { phase: "uploading"; capture: UniversalCaptureResult }
  | { phase: "submitting"; capture: UniversalCaptureResult }
  | { phase: "polling"; capture: UniversalCaptureResult }
  | { phase: "result"; analysis: RafAnalysis }
  | { phase: "error"; capture: UniversalCaptureResult; message: string };

export type BetaResultAction =
  | { type: "CAPTURED"; capture: UniversalCaptureResult }
  | { type: "RETAKE" }
  | { type: "ANALYSIS_STARTED" }
  | { type: "PROGRESS"; phase: AnalysisProgressPhase }
  | { type: "ANALYSIS_SUCCEEDED"; analysis: RafAnalysis }
  | { type: "ANALYSIS_FAILED"; message: string }
  | { type: "RESET" };

export const initialBetaResultState: BetaResultState = { phase: "idle" };

const IN_FLIGHT_PHASES = new Set(["uploading", "submitting", "polling"]);

export function betaResultReducer(state: BetaResultState, action: BetaResultAction): BetaResultState {
  switch (action.type) {
    case "CAPTURED":
      // Une capture n'est acceptée que depuis "idle" — jamais pendant un
      // envoi en cours (protège contre une seconde capture qui écraserait
      // silencieusement celle en cours d'analyse).
      if (state.phase !== "idle") return state;
      return { phase: "preview", capture: action.capture };

    case "RETAKE":
      // Retour caméra libre depuis l'aperçu (photo pas encore envoyée) ou
      // après une erreur — jamais pendant un envoi en cours.
      if (state.phase !== "preview" && state.phase !== "error") return state;
      return { phase: "idle" };

    case "ANALYSIS_STARTED":
      // Seule frontière qui déclenche un appel réseau : garde anti
      // double-tap incluse — un second "ANALYSIS_STARTED" pendant
      // uploading/submitting/polling est ignoré (l'état n'est déjà plus
      // "preview", donc la condition ci-dessous échoue silencieusement).
      if (state.phase !== "preview") return state;
      return { phase: "uploading", capture: state.capture };

    case "PROGRESS":
      if (!IN_FLIGHT_PHASES.has(state.phase)) return state;
      return { phase: action.phase, capture: (state as { capture: UniversalCaptureResult }).capture };

    case "ANALYSIS_SUCCEEDED":
      if (!IN_FLIGHT_PHASES.has(state.phase)) return state;
      return { phase: "result", analysis: action.analysis };

    case "ANALYSIS_FAILED":
      if (!IN_FLIGHT_PHASES.has(state.phase)) return state;
      return { phase: "error", capture: (state as { capture: UniversalCaptureResult }).capture, message: action.message };

    case "RESET":
      return { phase: "idle" };

    default:
      return state;
  }
}
