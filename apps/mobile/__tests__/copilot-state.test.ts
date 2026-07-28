import { createCopilotReducer, initialCopilotState, type CopilotState } from "../src/state/copilot-state";

/**
 * Couvre les cas exigés par le brief produit (section 17) : consentement
 * refusé, overlay refusé, plusieurs clics rapides, aucune capture sans
 * clic, arrêt du Copilote. Aucune dépendance native ici — pure logique
 * d'état (voir `docs/mobile/android-permissions.md` pour la checklist
 * manuelle qui couvre le reste sur l'émulateur).
 */
describe("copilotReducer", () => {
  it("aucune capture sans clic explicite sur la bulle", () => {
    const reducer = createCopilotReducer();
    let state: CopilotState = initialCopilotState;
    state = reducer(state, { type: "ENABLE_REQUESTED" });
    state = reducer(state, { type: "OVERLAY_PERMISSION_GRANTED" });
    expect(state).toEqual({ phase: "bubbleActive" });

    // Aucune action autre que BUBBLE_TAPPED ne peut faire progresser vers une capture.
    state = reducer(state, { type: "CAPTURE_COMPLETED", captureUri: "file://x" });
    expect(state).toEqual({ phase: "bubbleActive" });
  });

  it("overlay refusé : aucune bulle, retour à un état sans service actif", () => {
    const reducer = createCopilotReducer();
    let state: CopilotState = initialCopilotState;
    state = reducer(state, { type: "ENABLE_REQUESTED" });
    state = reducer(state, { type: "OVERLAY_PERMISSION_DENIED" });
    expect(state).toEqual({ phase: "overlayPermissionDenied" });
  });

  it("consentement de capture refusé : retour à la bulle active, pas de crash d'état", () => {
    const reducer = createCopilotReducer();
    let state: CopilotState = initialCopilotState;
    state = reducer(state, { type: "ENABLE_REQUESTED" });
    state = reducer(state, { type: "OVERLAY_PERMISSION_GRANTED" });
    state = reducer(state, { type: "BUBBLE_TAPPED" });
    expect(state).toEqual({ phase: "requestingCaptureConsent" });
    state = reducer(state, { type: "CAPTURE_CONSENT_DENIED" });
    expect(state).toEqual({ phase: "bubbleActive" });
  });

  it("plusieurs clics rapides sur la bulle : une seule capture déclenchée", () => {
    let now = 1_000;
    const reducer = createCopilotReducer({ now: () => now });
    let state: CopilotState = initialCopilotState;
    state = reducer(state, { type: "ENABLE_REQUESTED" });
    state = reducer(state, { type: "OVERLAY_PERMISSION_GRANTED" });

    state = reducer(state, { type: "BUBBLE_TAPPED" });
    expect(state).toEqual({ phase: "requestingCaptureConsent" });

    // Un second tap arrive 100ms plus tard alors qu'on est déjà en train de
    // demander le consentement — ignoré, pas une seconde demande empilée.
    now += 100;
    const stateAfterSecondTap = reducer(state, { type: "BUBBLE_TAPPED" });
    expect(stateAfterSecondTap).toEqual(state);
  });

  it("debounce : un nouveau tap est accepté après la fenêtre, une fois revenu à bubbleActive", () => {
    let now = 1_000;
    const reducer = createCopilotReducer({ now: () => now });
    let state: CopilotState = initialCopilotState;
    state = reducer(state, { type: "ENABLE_REQUESTED" });
    state = reducer(state, { type: "OVERLAY_PERMISSION_GRANTED" });
    state = reducer(state, { type: "BUBBLE_TAPPED" });
    state = reducer(state, { type: "CAPTURE_CONSENT_DENIED" }); // retour à bubbleActive
    expect(state).toEqual({ phase: "bubbleActive" });

    now += 5_000; // largement au-delà du debounce de 800ms
    state = reducer(state, { type: "BUBBLE_TAPPED" });
    expect(state).toEqual({ phase: "requestingCaptureConsent" });
  });

  it("arrêt du Copilote : toujours possible, quel que soit l'état courant", () => {
    const reducer = createCopilotReducer();
    let state: CopilotState = initialCopilotState;
    state = reducer(state, { type: "ENABLE_REQUESTED" });
    state = reducer(state, { type: "OVERLAY_PERMISSION_GRANTED" });
    state = reducer(state, { type: "BUBBLE_TAPPED" });
    state = reducer(state, { type: "SERVICE_STOPPED" });
    expect(state).toEqual({ phase: "stopped" });
  });

  it("capture terminée puis annulée : suppression de l'aperçu, retour à bubbleActive", () => {
    const reducer = createCopilotReducer();
    let state: CopilotState = initialCopilotState;
    state = reducer(state, { type: "ENABLE_REQUESTED" });
    state = reducer(state, { type: "OVERLAY_PERMISSION_GRANTED" });
    state = reducer(state, { type: "BUBBLE_TAPPED" });
    state = reducer(state, { type: "CAPTURE_CONSENT_GRANTED" });
    state = reducer(state, { type: "CAPTURE_COMPLETED", captureUri: "file://capture.jpg" });
    expect(state).toEqual({ phase: "previewingCapture", captureUri: "file://capture.jpg" });

    state = reducer(state, { type: "CAPTURE_CANCELLED" });
    expect(state).toEqual({ phase: "bubbleActive" });
  });
});
