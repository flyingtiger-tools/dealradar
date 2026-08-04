import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Image, Platform, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  createCopilotReducer,
  initialCopilotState,
  type CopilotAction,
  type CopilotState,
} from "./state/copilot-state";
import { isOverlayCopilotSupported, overlayCopilot, subscribeToBubbleTapped } from "./native/overlay-copilot";
import { createAnalysis, pollAnalysisUntilSettled } from "./api/analyses-client";
import { decodeJwtUserId } from "./api/decode-jwt-user-id";
import { TcgScanScreen } from "./screens/TcgScanScreen";
import { UniversalCaptureScreen } from "./capture/UniversalCaptureScreen";
import type { UniversalCaptureResult } from "./capture/types";
import type { AnalysisResponse } from "@dealradar/contracts";

// "universalCapture" : onglet séparé pour valider le LOT Universal Capture Intake sur
// appareil réel (ADR 0013) — n'affecte jamais le flux "tcgScan" existant.
type AppTab = "copilot" | "tcgScan" | "universalCapture";

/**
 * Spike Android (ADR 0010, section 16 du brief) : prouve le flux
 * bulle -> consentement -> capture unique -> aperçu -> analyse réelle, pas
 * plus. Aucune logique financière ici — l'écran affiche ce que
 * POST /v1/analyses retourne, il ne calcule jamais un score lui-même.
 */
export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("copilot");
  const [state, setState] = useState<CopilotState>(initialCopilotState);
  const reducerRef = useRef(createCopilotReducer());
  // Champ de saisie manuelle pour ce spike/lot uniquement — une V1 réelle
  // authentifie via Supabase Auth et stocke le jeton dans Keychain/Keystore
  // (expo-secure-store), jamais dans un état React en clair (voir
  // docs/mobile/privacy-and-retention.md).
  const [accessToken, setAccessToken] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<UniversalCaptureResult | null>(null);
  const userId = accessToken ? decodeJwtUserId(accessToken) : null;

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
    if (state.phase !== "previewingCapture" || !accessToken) return;
    setError(null);
    try {
      const created = await createAnalysis(accessToken, {
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
        clientRequestId: crypto.randomUUID(),
        providedTcgHints: null,
      });
      const settled = await pollAnalysisUntilSettled(accessToken, created.id);
      setAnalysis(settled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue lors de l'analyse.");
    }
  }, [state, accessToken]);

  if (activeTab === "tcgScan") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.tabBar}>
          <Button title="Copilote" onPress={() => setActiveTab("copilot")} />
          <Button title="Scanner Pokémon" onPress={() => setActiveTab("tcgScan")} disabled />
          <Button title="Capture universelle (bêta)" onPress={() => setActiveTab("universalCapture")} />
        </View>
        <TextInput
          style={styles.input}
          placeholder="Jeton d'accès (dev uniquement)"
          value={accessToken}
          onChangeText={setAccessToken}
        />
        {!userId && accessToken.length > 0 && <Text style={styles.warning}>Jeton invalide — identifiant utilisateur introuvable.</Text>}
        {accessToken && userId ? (
          <TcgScanScreen accessToken={accessToken} userId={userId} />
        ) : (
          <Text style={styles.phase}>Colle un jeton d'accès valide pour scanner une carte.</Text>
        )}
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
        </View>
        {lastCapture ? (
          <View style={styles.previewBox}>
            <Text style={styles.result}>{JSON.stringify(lastCapture, null, 2)}</Text>
            <Button title="Nouvelle capture" onPress={() => setLastCapture(null)} />
          </View>
        ) : (
          <UniversalCaptureScreen onCaptured={setLastCapture} onCancel={() => setActiveTab("copilot")} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabBar}>
        <Button title="Copilote" onPress={() => setActiveTab("copilot")} disabled />
        <Button title="Scanner Pokémon" onPress={() => setActiveTab("tcgScan")} />
        <Button title="Capture universelle (bêta)" onPress={() => setActiveTab("universalCapture")} />
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
          <TextInput
            style={styles.input}
            placeholder="Jeton d'accès (dev uniquement)"
            value={accessToken}
            onChangeText={setAccessToken}
          />
          <Button title="Annuler et supprimer" onPress={cancelAndDelete} />
          <Button title="Analyser" onPress={analyzeCapture} disabled={!accessToken} />
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
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
});
