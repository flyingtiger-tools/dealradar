import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/**
 * `expo` ré-exporte `requireOptionalNativeModule` depuis `expo-modules-core`
 * (voir node_modules/expo/src/Expo.ts) — import via `expo` plutôt que
 * `expo-modules-core` directement, `expo-doctor` interdit ce dernier en
 * dépendance directe (« should not be installed directly »). Seule la
 * méthode `.remove()` de la valeur de retour de `addListener` est utilisée
 * ici, d'où ce type structurel minimal plutôt que le type `EventSubscription`
 * exact d'`expo-modules-core` (qu'`expo` ne ré-exporte pas).
 */
interface EventSubscription {
  remove(): void;
}

/**
 * Pont vers le module natif Android `overlay-copilot`
 * (`modules/overlay-copilot`, ADR 0010). Aucune contrepartie iOS — la bulle
 * n'existe que sur Android (voir ADR 0010, asymétrie assumée).
 *
 * API Expo Modules (`requireOptionalNativeModule`), pas le pont classique
 * `NativeModules` — le module natif est écrit avec l'API Expo Modules
 * (`Module`/`ModuleDefinition`, voir OverlayCopilotModule.kt), qui ne
 * s'enregistre jamais dans `NativeModules`. Bug réel rencontré en testant
 * sur l'émulateur (le bouton restait bloqué sur "requestingOverlayPermission"
 * sans jamais afficher l'écran système ni logguer d'erreur) — corrigé ici,
 * voir docs/mobile/readiness-audit.md.
 */
interface OverlayCopilotNativeModule {
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): Promise<boolean>;
  startBubbleService(): Promise<void>;
  stopBubbleService(): Promise<void>;
  /** Déclenche le dialogue MediaProjection puis une capture unique — jamais appelé ailleurs que sur un tap utilisateur explicite. */
  requestSingleCapture(): Promise<{ uri: string } | null>;
  deleteCapture(uri: string): Promise<void>;
  addListener(eventName: "OverlayCopilot.bubbleTapped", listener: () => void): EventSubscription;
}

const NativeOverlayCopilot = requireOptionalNativeModule<OverlayCopilotNativeModule>("OverlayCopilot");

export function isOverlayCopilotSupported(): boolean {
  return Platform.OS === "android" && NativeOverlayCopilot !== null;
}

function requireNativeModule(): OverlayCopilotNativeModule {
  if (!NativeOverlayCopilot) {
    throw new Error(
      "OverlayCopilot n'est disponible que sur Android, dans un Development Build (pas Expo Go) — voir ADR 0010.",
    );
  }
  return NativeOverlayCopilot;
}

export const overlayCopilot = {
  hasOverlayPermission: () => requireNativeModule().hasOverlayPermission(),
  requestOverlayPermission: () => requireNativeModule().requestOverlayPermission(),
  startBubbleService: () => requireNativeModule().startBubbleService(),
  stopBubbleService: () => requireNativeModule().stopBubbleService(),
  requestSingleCapture: () => requireNativeModule().requestSingleCapture(),
  deleteCapture: (uri: string) => requireNativeModule().deleteCapture(uri),
};

/**
 * Événement émis par le service natif quand l'utilisateur appuie sur la
 * bulle — c'est le seul déclencheur possible d'une capture (jamais un
 * minuteur). Voir `src/state/copilot-state.ts` pour la machine à états qui
 * consomme cet événement.
 */
export function subscribeToBubbleTapped(listener: () => void): () => void {
  if (!NativeOverlayCopilot) return () => undefined;
  const subscription = NativeOverlayCopilot.addListener("OverlayCopilot.bubbleTapped", listener);
  return () => subscription.remove();
}
