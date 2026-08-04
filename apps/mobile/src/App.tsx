import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Image, Platform, SafeAreaView, StyleSheet, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { Session } from "@supabase/supabase-js";
import {
  createCopilotReducer,
  initialCopilotState,
  type CopilotAction,
  type CopilotState,
} from "./state/copilot-state";
import { isOverlayCopilotSupported, overlayCopilot, subscribeToBubbleTapped } from "./native/overlay-copilot";
import { createAnalysis, pollAnalysisUntilSettled } from "./api/analyses-client";
import { TcgScanScreen } from "./screens/TcgScanScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { getCurrentSession, onSessionChange, signOut } from "./auth/session";
import { UniversalCaptureBetaScreen } from "./screens/UniversalCaptureBetaScreen";
import type { AnalysisResponse } from "@dealradar/contracts";

// "universalCapture" : onglet séparé pour valider le LOT Universal Capture Intake sur
// appareil réel (ADR 0013) — n'affecte jamais le flux "tcgScan" existant.
type AppTab = "copilot" | "tcgScan" | "universalCapture";

/**
 * Racine de l'app (ADR 0010, LOT 8, authentification réelle LOT 9).
 *
 * Authentification : `session === undefined` pendant la vérification
 * initiale (`getCurrentSession()`), `null` sans session active → affiche
 * `LoginScreen`, un objet `Session` → affiche l'app. `onSessionChange`
 * réagit à toute connexion/déconnexion/rafraîchissement/expiration — si le
 * rafraîchissement automatique du SDK échoue finalement (refresh token
 * expiré/révoqué), Supabase émet une session `null` et cet écran bascule
 * automatiquement sur `LoginScreen`, sans code de redirection dédié.
 *
 * Plus aucun champ de jeton saisi manuellement nulle part dans cet écran.
 */
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<AppTab>("copilot");
  const [state, setState] = useState<CopilotState>(initialCopilotState);
  const reducerRef = useRef(createCopilotReducer());
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentSession().then((current) => {
      if (!cancelled) setSession(current);
    });
    const unsubscribe = onSessionChange(setSession);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

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

  // Le tap sur la bulle amène l'état à "requestingCaptureConsent" ; ce
  // useEffect déclenche alors — et seulement alors — le dialogue
  // MediaProjection (jamais avant, jamais en dehors de ce chemin).
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

  if (session === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.phase}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  if (session === null) {
    return <LoginScreen />;
  }

  if (activeTab === "tcgScan") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.tabBar}>
          <Button title="Copilote" onPress={() => setActiveTab("copilot")} />
          <Button title="Scanner Pokémon" onPress={() => setActiveTab("tcgScan")} disabled />
          <Button title="Capture universelle (bêta)" onPress={() => setActiveTab("universalCapture")} />
          <Button title="Déconnexion" onPress={() => void signOut()} />
        </View>
        <TcgScanScreen />
      </SafeAreaView>
    );
  }

  if (activeTab === "universalCapture") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.tabBar}>
          <Button title="Copilote" onPress={() => setActiveTab("copilot")} />
          <Button title="Scanner Pokémon" onPress={() => setActiveTab("tcgScan")} />
          <Button title="Capture universelle (bêta)" onPress={() => setActiveTab("universalCapture")} disabled />
          <Button title="Déconnexion" onPress={() => void signOut()} />
        </View>
        <UniversalCaptureBetaScreen onExit={() => setActiveTab("copilot")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabBar}>
        <Button title="Copilote" onPress={() => setActiveTab("copilot")} disabled />
        <Button title="Scanner Pokémon" onPress={() => setActiveTab("tcgScan")} />
        <Button title="Capture universelle (bêta)" onPress={() => setActiveTab("universalCapture")} />
        <Button title="Déconnexion" onPress={() => void signOut()} />
      </View>
      <Text style={styles.title}>DealRadar Copilote — spike</Text>
      <Text style={styles.phase}>État : {state.phase}</Text>

      {Platform.OS !== "android" && <Text style={styles.warning}>Bulle indisponible hors Android (ADR 0010).</Text>}

      {state.phase === "idle" || state.phase === "stopped" || state.phase === "overlayPermissionDenied" ? (
        <Button title="Activer le Copilote" onPress={enableCopilot} />
      ) : null}

      {state.phase === "overlayPermissionDenied" && (
        <Text style={styles.warning}>Permission refusée — aucune bulle, aucun service actif.</Text>
      )}

      {state.phase === "bubbleActive" && <Button title="Désactiver le Copilote" onPress={disableCopilot} />}

      {state.phase === "captureConsentDenied" && <Text style={styles.warning}>Capture refusée par l'utilisateur.</Text>}

      {state.phase === "previewingCapture" && (
        <View style={styles.previewBox}>
          <Image source={{ uri: state.captureUri }} style={styles.preview} />
          <Button title="Annuler et supprimer" onPress={cancelAndDelete} />
          <Button title="Analyser" onPress={analyzeCapture} />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {analysis && <Text style={styles.result}>Résultat : {JSON.stringify(analysis, null, 2)}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  tabBar: { flexDirection: "row", gap: 12, marginBottom: 8, flexWrap: "wrap" },
  title: { fontSize: 20, fontWeight: "600" },
  phase: { fontSize: 14, color: "#666" },
  warning: { color: "#b45309" },
  error: { color: "#b91c1c" },
  result: { fontFamily: "monospace", fontSize: 11 },
  previewBox: { gap: 8 },
  preview: { width: "100%", height: 200, resizeMode: "contain", backgroundColor: "#eee" },
});
