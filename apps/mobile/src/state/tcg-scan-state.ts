import type { TcgCardAnalysisResult, TcgCardProvidedHints } from "@dealradar/contracts";

/**
 * Machine à états pure du scan photo carte Pokémon (LOT 8) — même esprit
 * que `copilot-state.ts` : aucune dépendance native/réseau ici, seulement
 * des transitions testables en JS pur. L'écran (`TcgScanScreen.tsx`) pilote
 * cette machine, il ne la réimplémente jamais.
 */

export type TcgScanState =
  | { phase: "idle" }
  | { phase: "previewingImage"; imageUri: string }
  | { phase: "uploading"; imageUri: string }
  | { phase: "submitting"; imageUri: string }
  | { phase: "polling"; requestId: string }
  | { phase: "needsConfirmation"; requestId: string; fields: TcgCardProvidedHints }
  | { phase: "resubmitting"; requestId: string }
  | { phase: "result"; requestId: string; result: TcgCardAnalysisResult | null; status: "completed" | "insufficient_data" | "failed" }
  | { phase: "error"; message: string };

export type TcgScanAction =
  | { type: "IMAGE_SELECTED"; imageUri: string }
  | { type: "CANCELLED" }
  | { type: "UPLOAD_STARTED" }
  | { type: "SUBMIT_STARTED"; requestId: string }
  /** Couvre tout échec réseau entre le début de l'envoi et la réception du résultat — un seul état d'erreur terminal, quelle que soit l'étape en cours. */
  | { type: "FAILED"; message: string }
  | { type: "RESULT_RECEIVED"; result: TcgCardAnalysisResult | null; status: "completed" | "insufficient_data" | "failed" }
  | { type: "CONFIRMATION_FIELD_CHANGED"; field: keyof TcgCardProvidedHints; value: string | null }
  | { type: "CONFIRMATION_SUBMITTED" }
  | { type: "RESET" };

export function extractedFieldsToProvidedHints(fields: {
  cardName: string | null;
  setName: string | null;
  cardNumber: string | null;
  variant: string | null;
  language: string | null;
  productKind: "raw_card" | "graded_card" | null;
  gradingCompany: string | null;
  grade: string | null;
}): TcgCardProvidedHints {
  return {
    cardName: fields.cardName,
    setName: fields.setName,
    cardNumber: fields.cardNumber,
    variant: fields.variant,
    language: fields.language,
    productKind: fields.productKind,
    gradingCompany: fields.gradingCompany,
    grade: fields.grade,
  };
}

export function tcgScanReducer(state: TcgScanState, action: TcgScanAction): TcgScanState {
  switch (action.type) {
    case "IMAGE_SELECTED":
      if (state.phase !== "idle" && state.phase !== "result" && state.phase !== "error") return state;
      return { phase: "previewingImage", imageUri: action.imageUri };

    case "CANCELLED":
      return { phase: "idle" };

    case "UPLOAD_STARTED":
      if (state.phase !== "previewingImage") return state;
      return { phase: "uploading", imageUri: state.imageUri };

    case "SUBMIT_STARTED":
      if (state.phase !== "uploading" && state.phase !== "resubmitting") return state;
      return { phase: "polling", requestId: action.requestId };

    case "FAILED":
      if (state.phase !== "uploading" && state.phase !== "polling" && state.phase !== "resubmitting") return state;
      return { phase: "error", message: action.message };

    case "RESULT_RECEIVED": {
      if (state.phase !== "polling") return state;
      if (action.status === "insufficient_data" && action.result?.kind === "pokemon_tcg_card" && action.result.needsConfirmation) {
        return { phase: "needsConfirmation", requestId: state.requestId, fields: extractedFieldsToProvidedHints(action.result.extractedFields) };
      }
      return { phase: "result", requestId: state.requestId, result: action.result, status: action.status };
    }

    case "CONFIRMATION_FIELD_CHANGED":
      if (state.phase !== "needsConfirmation") return state;
      return { ...state, fields: { ...state.fields, [action.field]: action.value } };

    case "CONFIRMATION_SUBMITTED":
      if (state.phase !== "needsConfirmation") return state;
      return { phase: "resubmitting", requestId: state.requestId };

    case "RESET":
      return { phase: "idle" };

    default:
      return state;
  }
}

export const initialTcgScanState: TcgScanState = { phase: "idle" };
