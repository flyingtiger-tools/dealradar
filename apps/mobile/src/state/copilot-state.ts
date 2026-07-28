/**
 * Machine à états pure du Copilote (ADR 0010) — aucune dépendance native
 * ici, seulement des transitions testables en JS pur. Le module natif
 * (`src/native/overlay-copilot.ts`) pilote cette machine, il ne la
 * réimplémente jamais côté Kotlin.
 *
 * Règle absolue vérifiée par cette machine : aucune capture n'est jamais
 * déclenchée sans passer par l'état "capturing", lui-même atteignable
 * uniquement depuis "bubbleActive" via l'action explicite `BUBBLE_TAPPED` —
 * jamais depuis un minuteur ou un événement système.
 */

export type CopilotState =
  | { phase: "idle" }
  | { phase: "requestingOverlayPermission" }
  | { phase: "overlayPermissionDenied" }
  | { phase: "bubbleActive" }
  | { phase: "requestingCaptureConsent" }
  | { phase: "captureConsentDenied" }
  | { phase: "capturing" }
  | { phase: "previewingCapture"; captureUri: string }
  | { phase: "stopped" };

export type CopilotAction =
  | { type: "ENABLE_REQUESTED" }
  | { type: "OVERLAY_PERMISSION_GRANTED" }
  | { type: "OVERLAY_PERMISSION_DENIED" }
  | { type: "BUBBLE_TAPPED" }
  | { type: "CAPTURE_CONSENT_GRANTED" }
  | { type: "CAPTURE_CONSENT_DENIED" }
  | { type: "CAPTURE_COMPLETED"; captureUri: string }
  | { type: "CAPTURE_CANCELLED" }
  | { type: "SERVICE_STOPPED" };

/**
 * `lastTapAtMs`/`now` séparés de l'état affiché : le debounce est une
 * propriété de la fonction de transition, jamais un état visible qui
 * pourrait dériver de l'horloge système (déterminisme testable).
 */
const BUBBLE_TAP_DEBOUNCE_MS = 800;

export interface CopilotReducerContext {
  now: () => number;
}

export function createCopilotReducer(context: CopilotReducerContext = { now: () => Date.now() }) {
  let lastBubbleTapAtMs: number | null = null;

  return function copilotReducer(state: CopilotState, action: CopilotAction): CopilotState {
    switch (action.type) {
      case "ENABLE_REQUESTED":
        if (state.phase !== "idle" && state.phase !== "stopped" && state.phase !== "overlayPermissionDenied") {
          return state;
        }
        return { phase: "requestingOverlayPermission" };

      case "OVERLAY_PERMISSION_GRANTED":
        if (state.phase !== "requestingOverlayPermission") return state;
        return { phase: "bubbleActive" };

      case "OVERLAY_PERMISSION_DENIED":
        if (state.phase !== "requestingOverlayPermission") return state;
        return { phase: "overlayPermissionDenied" };

      case "BUBBLE_TAPPED": {
        if (state.phase !== "bubbleActive") return state;
        const now = context.now();
        // Double-tap rapide : une seule capture déclenchée, jamais deux
        // requêtes de consentement empilées (menace "plusieurs clics rapides").
        if (lastBubbleTapAtMs !== null && now - lastBubbleTapAtMs < BUBBLE_TAP_DEBOUNCE_MS) {
          return state;
        }
        lastBubbleTapAtMs = now;
        return { phase: "requestingCaptureConsent" };
      }

      case "CAPTURE_CONSENT_GRANTED":
        if (state.phase !== "requestingCaptureConsent") return state;
        return { phase: "capturing" };

      case "CAPTURE_CONSENT_DENIED":
        if (state.phase !== "requestingCaptureConsent") return state;
        return { phase: "bubbleActive" };

      case "CAPTURE_COMPLETED":
        if (state.phase !== "capturing") return state;
        return { phase: "previewingCapture", captureUri: action.captureUri };

      case "CAPTURE_CANCELLED":
        if (state.phase !== "capturing" && state.phase !== "previewingCapture") return state;
        return { phase: "bubbleActive" };

      case "SERVICE_STOPPED":
        // Toujours autorisé, quel que soit l'état — arrêt d'urgence.
        return { phase: "stopped" };

      default:
        return state;
    }
  };
}

export const initialCopilotState: CopilotState = { phase: "idle" };
