import { betaResultReducer, initialBetaResultState } from "../beta-result-state";
import type { RafAnalysis } from "../types";
import type { UniversalCaptureResult } from "../../capture/types";

function fakeCapture(): UniversalCaptureResult {
  return {
    captureType: "camera",
    normalizedImage: { uri: "file://normalized.jpg", width: 1200, height: 1600, format: "jpeg" },
    detectedRegions: [{ kind: "guide_frame_assumed", corners: null, crop: { uri: "file://crop.jpg", width: 900, height: 1200 } }],
    barcodes: [],
    orientation: { exifOrientation: 1, pixelsPhysicallyRotated: true },
    qualitySignals: {
      originalWidth: 1200,
      originalHeight: 1600,
      fileSizeBytes: 500_000,
      exposureTimeSeconds: null,
      isoSpeed: null,
      assumedRegionCropWidth: 900,
      assumedRegionCropHeight: 1200,
    },
    warnings: [],
  };
}

function fakeAnalysis(): RafAnalysis {
  return {
    category: "pokemon_tcg",
    status: "identified",
    product: { name: "Nymble", setName: "Phantasmal Flames", collectorNumber: "096", language: "en" },
    confidence: 0.9,
    decision: null,
    dealScore: null,
    valuation: { low: 1, high: 2, currency: "CHF" },
    evidence: [],
    missingInformation: [],
    risks: [],
    analysisId: "analysis-1",
  };
}

describe("betaResultReducer — état initial et capture sans analyse", () => {
  it("état initial : idle", () => {
    expect(initialBetaResultState).toEqual({ phase: "idle" });
  });

  it("CAPTURED depuis idle : passe à preview, jamais plus loin — aucun appel réseau à ce stade", () => {
    const capture = fakeCapture();
    const state = betaResultReducer(initialBetaResultState, { type: "CAPTURED", capture });
    expect(state).toEqual({ phase: "preview", capture });
  });

  it("CAPTURED pendant un envoi en cours : ignoré, jamais d'écrasement silencieux de la capture en vol", () => {
    const uploading = { phase: "uploading" as const, capture: fakeCapture() };
    const state = betaResultReducer(uploading, { type: "CAPTURED", capture: fakeCapture() });
    expect(state).toBe(uploading);
  });
});

describe("betaResultReducer — aperçu visible, retake", () => {
  it("l'état preview porte la capture telle quelle (aperçu affichable)", () => {
    const capture = fakeCapture();
    const state = betaResultReducer(initialBetaResultState, { type: "CAPTURED", capture });
    expect(state.phase).toBe("preview");
    expect((state as { capture: UniversalCaptureResult }).capture).toBe(capture);
  });

  it("RETAKE depuis preview : retour à idle, sans avoir jamais quitté l'appareil", () => {
    const preview = { phase: "preview" as const, capture: fakeCapture() };
    expect(betaResultReducer(preview, { type: "RETAKE" })).toEqual({ phase: "idle" });
  });

  it("RETAKE depuis error : retour à idle (reprendre une photo après échec)", () => {
    const error = { phase: "error" as const, capture: fakeCapture(), message: "Erreur réseau" };
    expect(betaResultReducer(error, { type: "RETAKE" })).toEqual({ phase: "idle" });
  });

  it("RETAKE pendant un envoi en cours : ignoré — on ne peut pas reprendre une photo déjà en cours d'envoi", () => {
    const uploading = { phase: "uploading" as const, capture: fakeCapture() };
    expect(betaResultReducer(uploading, { type: "RETAKE" })).toBe(uploading);
  });
});

describe("betaResultReducer — analyse explicite uniquement", () => {
  it("ANALYSIS_STARTED depuis preview : passe à uploading, porte la capture", () => {
    const capture = fakeCapture();
    const preview = { phase: "preview" as const, capture };
    expect(betaResultReducer(preview, { type: "ANALYSIS_STARTED" })).toEqual({ phase: "uploading", capture });
  });

  it("ANALYSIS_STARTED depuis idle : ignoré — aucun appel réseau possible sans une photo prévisualisée", () => {
    expect(betaResultReducer(initialBetaResultState, { type: "ANALYSIS_STARTED" })).toEqual({ phase: "idle" });
  });

  it("double-tap sur Analyser : un second ANALYSIS_STARTED pendant uploading est ignoré", () => {
    const uploading = { phase: "uploading" as const, capture: fakeCapture() };
    const stillUploading = betaResultReducer(uploading, { type: "ANALYSIS_STARTED" });
    expect(stillUploading).toBe(uploading);
  });

  it("double-tap sur Analyser : un second ANALYSIS_STARTED pendant submitting est ignoré", () => {
    const submitting = { phase: "submitting" as const, capture: fakeCapture() };
    expect(betaResultReducer(submitting, { type: "ANALYSIS_STARTED" })).toBe(submitting);
  });

  it("double-tap sur Analyser : un second ANALYSIS_STARTED pendant polling est ignoré", () => {
    const polling = { phase: "polling" as const, capture: fakeCapture() };
    expect(betaResultReducer(polling, { type: "ANALYSIS_STARTED" })).toBe(polling);
  });
});

describe("betaResultReducer — progression réseau réelle", () => {
  it("PROGRESS uploading->submitting : transition, capture conservée", () => {
    const capture = fakeCapture();
    const uploading = { phase: "uploading" as const, capture };
    expect(betaResultReducer(uploading, { type: "PROGRESS", phase: "submitting" })).toEqual({ phase: "submitting", capture });
  });

  it("PROGRESS submitting->polling : transition, capture conservée", () => {
    const capture = fakeCapture();
    const submitting = { phase: "submitting" as const, capture };
    expect(betaResultReducer(submitting, { type: "PROGRESS", phase: "polling" })).toEqual({ phase: "polling", capture });
  });

  it("PROGRESS hors phase en vol (ex. depuis preview) : ignoré", () => {
    const preview = { phase: "preview" as const, capture: fakeCapture() };
    expect(betaResultReducer(preview, { type: "PROGRESS", phase: "uploading" })).toBe(preview);
  });
});

describe("betaResultReducer — succès et erreurs", () => {
  it("ANALYSIS_SUCCEEDED depuis polling : passe à result", () => {
    const polling = { phase: "polling" as const, capture: fakeCapture() };
    const analysis = fakeAnalysis();
    expect(betaResultReducer(polling, { type: "ANALYSIS_SUCCEEDED", analysis })).toEqual({ phase: "result", analysis });
  });

  it("erreur d'upload : ANALYSIS_FAILED depuis uploading passe à error, capture conservée pour retake", () => {
    const capture = fakeCapture();
    const uploading = { phase: "uploading" as const, capture };
    expect(betaResultReducer(uploading, { type: "ANALYSIS_FAILED", message: "Échec de l'envoi de la photo." })).toEqual({
      phase: "error",
      capture,
      message: "Échec de l'envoi de la photo.",
    });
  });

  it("erreur de création d'analyse : ANALYSIS_FAILED depuis submitting passe à error", () => {
    const capture = fakeCapture();
    const submitting = { phase: "submitting" as const, capture };
    expect(betaResultReducer(submitting, { type: "ANALYSIS_FAILED", message: "Échec de la création de l'analyse." })).toEqual({
      phase: "error",
      capture,
      message: "Échec de la création de l'analyse.",
    });
  });

  it("erreur de polling : ANALYSIS_FAILED depuis polling passe à error", () => {
    const capture = fakeCapture();
    const polling = { phase: "polling" as const, capture };
    expect(betaResultReducer(polling, { type: "ANALYSIS_FAILED", message: "Délai dépassé." })).toEqual({
      phase: "error",
      capture,
      message: "Délai dépassé.",
    });
  });

  it("ANALYSIS_SUCCEEDED/ANALYSIS_FAILED hors phase en vol : ignorés", () => {
    expect(betaResultReducer(initialBetaResultState, { type: "ANALYSIS_SUCCEEDED", analysis: fakeAnalysis() })).toEqual({ phase: "idle" });
    expect(betaResultReducer(initialBetaResultState, { type: "ANALYSIS_FAILED", message: "x" })).toEqual({ phase: "idle" });
  });
});

describe("betaResultReducer — annulation et reset", () => {
  it("RESET depuis n'importe quelle phase : retour à idle", () => {
    const result = { phase: "result" as const, analysis: fakeAnalysis() };
    expect(betaResultReducer(result, { type: "RESET" })).toEqual({ phase: "idle" });

    const preview = { phase: "preview" as const, capture: fakeCapture() };
    expect(betaResultReducer(preview, { type: "RESET" })).toEqual({ phase: "idle" });

    const error = { phase: "error" as const, capture: fakeCapture(), message: "x" };
    expect(betaResultReducer(error, { type: "RESET" })).toEqual({ phase: "idle" });
  });

  // LOT "Product History UX + Source Health + Interactive Cancellation +
  // Beta Readiness", section 6/7 — `UniversalScanScreen.tsx` réutilise
  // `RESET` (jamais une nouvelle action `CANCELLED`) pour l'annulation
  // interactive : ce bloc documente/vérifie la garantie qui rend cette
  // annulation SÛRE, phase par phase, sans dupliquer la logique d'écran.
  describe("annulation interactive : RESET depuis chaque phase 'en vol', jamais une entrée d'historique/erreur trompeuse pour un résultat tardif", () => {
    it("cancel-before-processing (RESET depuis uploading) : retour à idle, capture jamais réutilisée", () => {
      const uploading = { phase: "uploading" as const, capture: fakeCapture() };
      expect(betaResultReducer(uploading, { type: "RESET" })).toEqual({ phase: "idle" });
    });

    it("cancel-during-market-stage (RESET depuis polling) : retour à idle", () => {
      const polling = { phase: "polling" as const, capture: fakeCapture() };
      expect(betaResultReducer(polling, { type: "RESET" })).toEqual({ phase: "idle" });
    });

    it("un ANALYSIS_SUCCEEDED tardif après RESET (résolution de identifyCapture() APRÈS l'annulation locale) est ignoré : jamais un résultat/historique fantôme affiché après le retour à idle", () => {
      const polling = { phase: "polling" as const, capture: fakeCapture() };
      const idle = betaResultReducer(polling, { type: "RESET" });
      expect(idle).toEqual({ phase: "idle" });

      // La promesse en vol (identifyCapture()) se résout APRÈS le RESET —
      // le réducteur doit ignorer ce dispatch tardif (garde `isInFlight`).
      const late = betaResultReducer(idle, { type: "ANALYSIS_SUCCEEDED", analysis: fakeAnalysis() });
      expect(late).toEqual({ phase: "idle" });
    });

    it("un ANALYSIS_FAILED tardif après RESET (ex. AnalysisPollAbortedError levée par le signal côté client) est ignoré : jamais un écran d'erreur trompeur après un retour utilisateur déjà effectué", () => {
      const submitting = { phase: "submitting" as const, capture: fakeCapture() };
      const idle = betaResultReducer(submitting, { type: "RESET" });

      const late = betaResultReducer(idle, { type: "ANALYSIS_FAILED", message: "Analyse annulée." });
      expect(late).toEqual({ phase: "idle" });
    });

    it("cancel-after-terminal (RESET depuis result, un cycle déjà résolu) : reste un simple retour à idle, jamais une erreur", () => {
      const result = { phase: "result" as const, analysis: fakeAnalysis() };
      expect(betaResultReducer(result, { type: "RESET" })).toEqual({ phase: "idle" });
    });
  });
});
