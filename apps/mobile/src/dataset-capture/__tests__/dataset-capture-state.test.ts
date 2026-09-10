import { datasetCaptureReducer, initialDatasetCaptureState, type DatasetCaptureState } from "../dataset-capture-state";
import { emptyGroundTruthDraft } from "../types";
import type { UniversalCaptureResult } from "../../capture/types";

const CAPTURE: UniversalCaptureResult = {
  captureType: "camera",
  normalizedImage: { uri: "file://normalized.jpg", width: 3000, height: 4000, format: "jpeg" },
  detectedRegions: [],
  barcodes: [],
  orientation: { exifOrientation: 1, pixelsPhysicallyRotated: false },
  qualitySignals: {
    originalWidth: 3000,
    originalHeight: 4000,
    fileSizeBytes: 2_000_000,
    exposureTimeSeconds: null,
    isoSpeed: null,
    assumedRegionCropWidth: 1800,
    assumedRegionCropHeight: 2400,
  },
  warnings: [],
};

describe("datasetCaptureReducer", () => {
  it("état initial : idle", () => {
    expect(initialDatasetCaptureState).toEqual({ phase: "idle" });
  });

  it("CAPTURED depuis idle -> preview", () => {
    const state = datasetCaptureReducer(initialDatasetCaptureState, { type: "CAPTURED", capture: CAPTURE });
    expect(state).toEqual({ phase: "preview", capture: CAPTURE });
  });

  it("CAPTURED ignoré si déjà en cours d'édition (anti double-capture)", () => {
    const editing: DatasetCaptureState = { phase: "editingGroundTruth", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null };
    const state = datasetCaptureReducer(editing, { type: "CAPTURED", capture: CAPTURE });
    expect(state).toBe(editing);
  });

  it("RETAKE depuis preview -> idle", () => {
    const preview: DatasetCaptureState = { phase: "preview", capture: CAPTURE };
    expect(datasetCaptureReducer(preview, { type: "RETAKE" })).toEqual({ phase: "idle" });
  });

  it("RETAKE depuis error -> idle (permet de recommencer après un échec de sauvegarde)", () => {
    const error: DatasetCaptureState = { phase: "error", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null, message: "échec disque" };
    expect(datasetCaptureReducer(error, { type: "RETAKE" })).toEqual({ phase: "idle" });
  });

  it("RETAKE ignoré pendant saving (jamais d'interruption d'une sauvegarde déjà lancée)", () => {
    const saving: DatasetCaptureState = { phase: "saving", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null };
    expect(datasetCaptureReducer(saving, { type: "RETAKE" })).toBe(saving);
  });

  it("CONTINUE_TO_EDIT depuis preview -> editingGroundTruth avec un brouillon vide", () => {
    const preview: DatasetCaptureState = { phase: "preview", capture: CAPTURE };
    const state = datasetCaptureReducer(preview, { type: "CONTINUE_TO_EDIT" });
    expect(state).toEqual({ phase: "editingGroundTruth", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null });
  });

  it("CONTINUE_TO_EDIT ignoré hors preview", () => {
    expect(datasetCaptureReducer(initialDatasetCaptureState, { type: "CONTINUE_TO_EDIT" })).toBe(initialDatasetCaptureState);
  });

  it("START_EDIT_EXISTING depuis idle -> editingGroundTruth avec editingExampleId renseigné", () => {
    const draft = emptyGroundTruthDraft();
    const state = datasetCaptureReducer(initialDatasetCaptureState, { type: "START_EDIT_EXISTING", capture: CAPTURE, draft, exampleId: "ex-1" });
    expect(state).toEqual({ phase: "editingGroundTruth", capture: CAPTURE, draft, editingExampleId: "ex-1" });
  });

  it("UPDATE_DRAFT met à jour le brouillon sans changer editingExampleId", () => {
    const editing: DatasetCaptureState = { phase: "editingGroundTruth", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: "ex-2" };
    const nextDraft = { ...emptyGroundTruthDraft(), cardName: "Nymble" };
    const state = datasetCaptureReducer(editing, { type: "UPDATE_DRAFT", draft: nextDraft });
    expect(state).toEqual({ phase: "editingGroundTruth", capture: CAPTURE, draft: nextDraft, editingExampleId: "ex-2" });
  });

  it("SAVE_REQUESTED depuis editingGroundTruth -> saving, conserve capture/draft/editingExampleId", () => {
    const editing: DatasetCaptureState = { phase: "editingGroundTruth", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: "ex-3" };
    const state = datasetCaptureReducer(editing, { type: "SAVE_REQUESTED" });
    expect(state).toEqual({ phase: "saving", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: "ex-3" });
  });

  it("SAVE_REQUESTED ignoré hors editingGroundTruth (anti double-tap)", () => {
    const saving: DatasetCaptureState = { phase: "saving", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null };
    expect(datasetCaptureReducer(saving, { type: "SAVE_REQUESTED" })).toBe(saving);
  });

  it("SAVE_SUCCEEDED depuis saving -> saved", () => {
    const saving: DatasetCaptureState = { phase: "saving", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null };
    const state = datasetCaptureReducer(saving, { type: "SAVE_SUCCEEDED", exampleId: "ex-4", duplicateCandidateIds: ["ex-1"] });
    expect(state).toEqual({ phase: "saved", exampleId: "ex-4", duplicateCandidateIds: ["ex-1"] });
  });

  it("SAVE_SUCCEEDED ignoré hors saving", () => {
    expect(datasetCaptureReducer(initialDatasetCaptureState, { type: "SAVE_SUCCEEDED", exampleId: "x", duplicateCandidateIds: [] })).toBe(
      initialDatasetCaptureState,
    );
  });

  it("SAVE_FAILED depuis saving -> error, conserve capture/draft pour permettre une nouvelle tentative", () => {
    const saving: DatasetCaptureState = { phase: "saving", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null };
    const state = datasetCaptureReducer(saving, { type: "SAVE_FAILED", message: "disque plein" });
    expect(state).toEqual({ phase: "error", capture: CAPTURE, draft: emptyGroundTruthDraft(), editingExampleId: null, message: "disque plein" });
  });

  it("RESET ramène toujours à idle, depuis n'importe quelle phase", () => {
    const saved: DatasetCaptureState = { phase: "saved", exampleId: "ex-5", duplicateCandidateIds: [] };
    expect(datasetCaptureReducer(saved, { type: "RESET" })).toEqual({ phase: "idle" });
  });
});
