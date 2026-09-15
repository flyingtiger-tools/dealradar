import { useCallback, useEffect, useRef, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import {
  createCopilotReducer,
  initialCopilotState,
  type CopilotAction,
  type CopilotState,
} from "../../state/copilot-state";
import { isOverlayCopilotSupported, overlayCopilot, subscribeToBubbleTapped } from "../../native/overlay-copilot";
import { createAnalysis, pollAnalysisUntilSettled } from "../../api/analyses-client";
import type { AnalysisResponse } from "@dealradar/contracts";
import { AppButton } from "../../components/ui/AppButton";
import { colors, spacing, typography } from "../../theme/tokens";

export interface CopilotScreenProps {
  onBack: () => void;
}

/**
 * "Copilote" — spike ADR 0010 (bulle flottante Android, capture d'écran
 * MediaProjection). LOGIQUE INCHANGÉE, déplacée telle quelle depuis
 * l'ancien `App.tsx` (Phase "fondation produit Raf" : ce lot ne touche
 * jamais au pipeline photo→prix, cette feature en dépend indirectement
 * via `createAnalysis`/`pollAnalysisUntilSettled`, donc seule sa POSITION
 * dans la navigation change — désormais Outils internes, plus un onglet
 * principal, car c'est une preuve de concept, pas le flux consommateur
 * (voir docs/mobile/ui-product-foundation.md).
 */
export function CopilotScreen({ onBack }: CopilotScreenProps) {
  const [state, setState] = useState<CopilotState>(initialCopilotState);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Instance unique via useRef (pas recréée à chaque dispatch) : le reducer
  // ferme sur un état mutable interne (`lastBubbleTapAtMs`, debounce des
  // taps de bulle) — identique au comportement de l'ancien `App.tsx`.
  const reducerRef = useRef(createCopilotReducer());

  const dispatch = useCallback((action: CopilotAction) => {
    setState((current) => reducerRef.current(current, action));
  }, []);

  useEffect(() => subscribeToBubbleTapped(() => dispatch({ type: "BUBBLE_TAPPED" })), [dispatch]);

  const enableCopilot = useCallback(async () => {
    if (!isOverlayCopilotSupported()) {
      setError("Le Copilote n'est disponible que sur Android, en Development Build.");
      return;
    }
    dispatch({ type: "ENABLE_REQUESTED" });
    const granted = await overlayCopilot.requestOverlayPermission();
    if (!granted) {
      dispatch({ type: "OVERLAY_PERMISSION_DENIED" });
      return;
    }
    await overlayCopilot.startBubbleService();
    dispatch({ type: "OVERLAY_PERMISSION_GRANTED" });
  }, [dispatch]);

  const disableCopilot = useCallback(async () => {
    if (isOverlayCopilotSupported()) await overlayCopilot.stopBubbleService();
    dispatch({ type: "SERVICE_STOPPED" });
  }, [dispatch]);

  useEffect(() => {
    if (state.phase !== "requestingCaptureConsent") return;
    let cancelled = false;
    (async () => {
      const result = await overlayCopilot.requestSingleCapture();
      if (cancelled) return;
      if (!result) {
        dispatch({ type: "CAPTURE_CONSENT_DENIED" });
        return;
      }
      dispatch({ type: "CAPTURE_CONSENT_GRANTED" });
      dispatch({ type: "CAPTURE_COMPLETED", captureUri: result.uri });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.phase, dispatch]);

  const cancelAndDelete = useCallback(async () => {
    if (state.phase === "previewingCapture") await overlayCopilot.deleteCapture(state.captureUri);
    dispatch({ type: "CAPTURE_CANCELLED" });
  }, [state, dispatch]);

  const analyzeCapture = useCallback(async () => {
    if (state.phase !== "previewingCapture") return;
    setError(null);
    try {
      const created = await createAnalysis({
        sourceType: "android_screen_capture",
        sourcePlatform: null,
        sharedUrl: null,
        title: null,
        description: null,
        categorySlug: null,
        purchasePrice: null,
        currency: "CHF",
        imageReferences: [],
        consentVersion: "1",
        clientRequestId: Crypto.randomUUID(),
        providedTcgHints: null,
      });
      const settled = await pollAnalysisUntilSettled(created.id);
      setAnalysis(settled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue lors de l'analyse.");
    }
  }, [state]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Copilote (spike)</Text>
      <Text style={styles.phase}>État : {state.phase}</Text>

      {state.phase === "idle" || state.phase === "stopped" || state.phase === "overlayPermissionDenied" ? (
        <AppButton title="Activer le Copilote" onPress={enableCopilot} variant="secondary" />
      ) : null}

      {state.phase === "overlayPermissionDenied" && <Text style={styles.warning}>Permission refusée — aucune bulle, aucun service actif.</Text>}

      {state.phase === "bubbleActive" && <AppButton title="Désactiver le Copilote" onPress={disableCopilot} variant="secondary" />}

      {state.phase === "captureConsentDenied" && <Text style={styles.warning}>Capture refusée par l'utilisateur.</Text>}

      {state.phase === "previewingCapture" && (
        <View style={styles.previewBox}>
          <Image source={{ uri: state.captureUri }} style={styles.preview} />
          <AppButton title="Annuler et supprimer" onPress={cancelAndDelete} variant="ghost" />
          <AppButton title="Analyser" onPress={analyzeCapture} />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {analysis && <Text style={styles.result}>Résultat : {JSON.stringify(analysis, null, 2)}</Text>}

      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary },
  phase: { ...typography.body, color: colors.textSecondary },
  warning: { color: colors.warning },
  error: { color: colors.danger },
  result: { fontFamily: "monospace", fontSize: 11, color: colors.textSecondary },
  previewBox: { gap: spacing.sm },
  preview: { width: "100%", height: 200, resizeMode: "contain", backgroundColor: colors.surface },
});
