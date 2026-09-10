import type { UniversalCaptureResult } from "../capture/types";
import { emptyGroundTruthDraft, type DatasetGroundTruthDraft } from "./types";

/**
 * Machine à états pure de l'outil "TCG Dataset Capture" (Phase 1, même
 * esprit que `beta-result-state.ts`) — aucune dépendance réseau/stockage
 * ici, seulement des transitions testables en JS pur. L'écran pilote cette
 * machine, il ne la réimplémente jamais.
 *
 * "preview" -> "editingGroundTruth" est le seul chemin vers une sauvegarde :
 * aucune saisie de vérité terrain n'est possible tant que la photo n'a pas
 * été explicitement conservée (pas de retake).
 */
export type DatasetCaptureState =
  | { phase: "idle" }
  | { phase: "preview"; capture: UniversalCaptureResult }
  | { phase: "editingGroundTruth"; capture: UniversalCaptureResult; draft: DatasetGroundTruthDraft; editingExampleId: string | null }
  | { phase: "saving"; capture: UniversalCaptureResult; draft: DatasetGroundTruthDraft; editingExampleId: string | null }
  | { phase: "saved"; exampleId: string; duplicateCandidateIds: string[] }
  | { phase: "error"; capture: UniversalCaptureResult; draft: DatasetGroundTruthDraft; editingExampleId: string | null; message: string };

export type DatasetCaptureAction =
  | { type: "CAPTURED"; capture: UniversalCaptureResult }
  | { type: "RETAKE" }
  | { type: "CONTINUE_TO_EDIT" }
  | { type: "START_EDIT_EXISTING"; capture: UniversalCaptureResult; draft: DatasetGroundTruthDraft; exampleId: string }
  | { type: "UPDATE_DRAFT"; draft: DatasetGroundTruthDraft }
  | { type: "SAVE_REQUESTED" }
  | { type: "SAVE_SUCCEEDED"; exampleId: string; duplicateCandidateIds: string[] }
  | { type: "SAVE_FAILED"; message: string }
  | { type: "RESET" };

export const initialDatasetCaptureState: DatasetCaptureState = { phase: "idle" };

function isEditableInFlight(
  state: DatasetCaptureState,
): state is Extract<DatasetCaptureState, { phase: "editingGroundTruth" | "saving" | "error" }> {
  return state.phase === "editingGroundTruth" || state.phase === "saving" || state.phase === "error";
}

export function datasetCaptureReducer(state: DatasetCaptureState, action: DatasetCaptureAction): DatasetCaptureState {
  switch (action.type) {
    case "CAPTURED":
      // Une capture n'est acceptée que depuis "idle" — jamais pendant une édition/sauvegarde en cours.
      if (state.phase !== "idle") return state;
      return { phase: "preview", capture: action.capture };

    case "RETAKE":
      if (state.phase !== "preview" && !isEditableInFlight(state)) return state;
      if (state.phase === "saving") return state; // jamais d'interruption pendant une sauvegarde déjà lancée
      return { phase: "idle" };

    case "CONTINUE_TO_EDIT":
      if (state.phase !== "preview") return state;
      return { phase: "editingGroundTruth", capture: state.capture, draft: emptyGroundTruthDraft(), editingExampleId: null };

    case "START_EDIT_EXISTING":
      // Point d'entrée dédié à l'édition d'un exemple déjà enregistré (bibliothèque) — jamais depuis "preview" (pas de re-capture).
      if (state.phase !== "idle") return state;
      return { phase: "editingGroundTruth", capture: action.capture, draft: action.draft, editingExampleId: action.exampleId };

    case "UPDATE_DRAFT":
      if (state.phase !== "editingGroundTruth" && state.phase !== "error") return state;
      return { ...state, phase: "editingGroundTruth", draft: action.draft };

    case "SAVE_REQUESTED":
      if (state.phase !== "editingGroundTruth") return state;
      return { phase: "saving", capture: state.capture, draft: state.draft, editingExampleId: state.editingExampleId };

    case "SAVE_SUCCEEDED":
      if (state.phase !== "saving") return state;
      return { phase: "saved", exampleId: action.exampleId, duplicateCandidateIds: action.duplicateCandidateIds };

    case "SAVE_FAILED":
      if (state.phase !== "saving") return state;
      return { phase: "error", capture: state.capture, draft: state.draft, editingExampleId: state.editingExampleId, message: action.message };

    case "RESET":
      return { phase: "idle" };

    default:
      return state;
  }
}
