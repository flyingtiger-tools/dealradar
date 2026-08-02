import { tcgScanReducer, initialTcgScanState, type TcgScanState } from "../src/state/tcg-scan-state";
import type { TcgCardAnalysisResult } from "@dealradar/contracts";

const needsConfirmationResult: TcgCardAnalysisResult = {
  kind: "pokemon_tcg_card",
  needsConfirmation: true,
  extractedFields: {
    category: "pokemon_tcg",
    game: "Pokémon",
    cardName: "Pikachu",
    setName: null,
    cardNumber: null,
    variant: null,
    language: null,
    productKind: null,
    gradingCompany: null,
    grade: null,
    confidence: 0.3,
    warnings: [],
  },
  identity: null,
  priceObservations: [],
  warnings: [],
  reason: null,
};

const completedResult: TcgCardAnalysisResult = {
  ...needsConfirmationResult,
  needsConfirmation: false,
  identity: {
    catalogExternalId: "base1-58",
    game: "pokemon",
    name: "Pikachu",
    setName: "Base Set",
    cardNumber: "58",
    variant: "Normal",
    language: "English",
    productKind: "raw_card",
    gradingCompany: null,
    grade: null,
    confidence: 1,
    catalogCorroboration: "corroborated",
  },
};

describe("tcgScanReducer", () => {
  it("aucune photo sélectionnée : impossible de passer directement à l'upload", () => {
    let state: TcgScanState = initialTcgScanState;
    state = tcgScanReducer(state, { type: "UPLOAD_STARTED" });
    expect(state).toEqual({ phase: "idle" });
  });

  it("flux normal : sélection -> upload -> soumission -> résultat identifié", () => {
    let state: TcgScanState = initialTcgScanState;
    state = tcgScanReducer(state, { type: "IMAGE_SELECTED", imageUri: "file://photo.jpg" });
    expect(state).toEqual({ phase: "previewingImage", imageUri: "file://photo.jpg" });

    state = tcgScanReducer(state, { type: "UPLOAD_STARTED" });
    expect(state).toEqual({ phase: "uploading", imageUri: "file://photo.jpg" });

    state = tcgScanReducer(state, { type: "SUBMIT_STARTED", requestId: "req-1" });
    expect(state).toEqual({ phase: "polling", requestId: "req-1" });

    state = tcgScanReducer(state, { type: "RESULT_RECEIVED", result: completedResult, status: "completed" });
    expect(state).toEqual({ phase: "result", requestId: "req-1", result: completedResult, status: "completed" });
  });

  it("extraction insuffisante : bascule vers needsConfirmation avec les champs détectés pré-remplis", () => {
    let state: TcgScanState = initialTcgScanState;
    state = tcgScanReducer(state, { type: "IMAGE_SELECTED", imageUri: "file://photo.jpg" });
    state = tcgScanReducer(state, { type: "UPLOAD_STARTED" });
    state = tcgScanReducer(state, { type: "SUBMIT_STARTED", requestId: "req-2" });
    state = tcgScanReducer(state, { type: "RESULT_RECEIVED", result: needsConfirmationResult, status: "insufficient_data" });

    expect(state.phase).toBe("needsConfirmation");
    if (state.phase === "needsConfirmation") {
      expect(state.fields.cardName).toBe("Pikachu");
      expect(state.fields.setName).toBeNull();
    }
  });

  it("correction d'un champ sur l'écran de confirmation, jamais forcé de tout ressaisir", () => {
    let state: TcgScanState = {
      phase: "needsConfirmation",
      requestId: "req-3",
      fields: { cardName: "Pikachu", setName: null, cardNumber: null, variant: null, language: null, productKind: null, gradingCompany: null, grade: null },
    };
    state = tcgScanReducer(state, { type: "CONFIRMATION_FIELD_CHANGED", field: "setName", value: "Base Set" });
    expect(state).toEqual({ phase: "needsConfirmation", requestId: "req-3", fields: expect.objectContaining({ cardName: "Pikachu", setName: "Base Set" }) });

    state = tcgScanReducer(state, { type: "CONFIRMATION_SUBMITTED" });
    expect(state).toEqual({ phase: "resubmitting", requestId: "req-3" });
  });

  it("annulation depuis l'aperçu : retour à idle, jamais d'upload déclenché", () => {
    let state: TcgScanState = initialTcgScanState;
    state = tcgScanReducer(state, { type: "IMAGE_SELECTED", imageUri: "file://photo.jpg" });
    state = tcgScanReducer(state, { type: "CANCELLED" });
    expect(state).toEqual({ phase: "idle" });
  });

  it("échec d'upload : état d'erreur explicite, jamais une soumission silencieuse", () => {
    let state: TcgScanState = initialTcgScanState;
    state = tcgScanReducer(state, { type: "IMAGE_SELECTED", imageUri: "file://photo.jpg" });
    state = tcgScanReducer(state, { type: "UPLOAD_STARTED" });
    state = tcgScanReducer(state, { type: "FAILED", message: "Réseau indisponible" });
    expect(state).toEqual({ phase: "error", message: "Réseau indisponible" });
  });

  it("échec pendant le polling (après soumission) : état d'erreur explicite, jamais bloqué sur le chargement", () => {
    let state: TcgScanState = initialTcgScanState;
    state = tcgScanReducer(state, { type: "IMAGE_SELECTED", imageUri: "file://photo.jpg" });
    state = tcgScanReducer(state, { type: "UPLOAD_STARTED" });
    state = tcgScanReducer(state, { type: "SUBMIT_STARTED", requestId: "req-5" });
    expect(state.phase).toBe("polling");
    state = tcgScanReducer(state, { type: "FAILED", message: "Délai dépassé" });
    expect(state).toEqual({ phase: "error", message: "Délai dépassé" });
  });

  it("RESET ramène toujours à idle, y compris depuis un résultat terminal", () => {
    let state: TcgScanState = { phase: "result", requestId: "req-4", result: completedResult, status: "completed" };
    state = tcgScanReducer(state, { type: "RESET" });
    expect(state).toEqual({ phase: "idle" });
  });
});
