import { useCallback, useState } from "react";
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from "react-native";
import { UniversalCaptureScreen } from "../capture/UniversalCaptureScreen";
import type { UniversalCaptureResult } from "../capture/types";
import { identifyCapture } from "../identification/identify-capture";
import { tcgAdapter } from "../identification/tcg-adapter";
import { betaResultReducer, initialBetaResultState, type BetaResultState } from "../identification/beta-result-state";

/**
 * Écran bêta prouvant le flux complet ADR 0013 : Universal Capture Intake
 * -> orchestrateur d'identification minimal -> TcgAdapter -> pipeline TCG
 * existant -> résultat générique. Design volontairement minimal (pas le
 * design final Raf, pas de revente, pas d'offres alternatives) — ne
 * remplace jamais `TcgScanScreen`, qui reste le flux de référence.
 */

interface UniversalCaptureBetaScreenProps {
  accessToken: string;
  userId: string;
  onExit: () => void;
}

export function UniversalCaptureBetaScreen({ accessToken, userId, onExit }: UniversalCaptureBetaScreenProps) {
  const [state, setState] = useState<BetaResultState>(initialBetaResultState);
  const dispatch = useCallback((action: Parameters<typeof betaResultReducer>[1]) => {
    setState((current) => betaResultReducer(current, action));
  }, []);

  const handleCaptured = useCallback(
    async (capture: UniversalCaptureResult) => {
      dispatch({ type: "ANALYSIS_STARTED" });
      try {
        const analysis = await identifyCapture(capture, "pokemon_tcg", { accessToken, userId }, [tcgAdapter]);
        dispatch({ type: "ANALYSIS_SUCCEEDED", analysis });
      } catch (e) {
        dispatch({ type: "ANALYSIS_FAILED", message: e instanceof Error ? e.message : "Erreur inconnue lors de l'identification." });
      }
    },
    [accessToken, userId, dispatch],
  );

  if (state.phase === "idle") {
    return <UniversalCaptureScreen onCaptured={(capture) => void handleCaptured(capture)} onCancel={onExit} />;
  }

  if (state.phase === "analyzing") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>Identification en cours…</Text>
      </View>
    );
  }

  if (state.phase === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{state.message}</Text>
        <Button title="Réessayer" onPress={() => dispatch({ type: "RESET" })} />
      </View>
    );
  }

  const { analysis } = state;
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Résultat (bêta)</Text>
      <Text style={styles.row}>Catégorie : {analysis.category ?? "inconnue"}</Text>
      <Text style={styles.row}>Statut : {analysis.status}</Text>
      <Text style={styles.row}>Produit : {analysis.product.name ?? "—"}</Text>
      <Text style={styles.row}>Set : {analysis.product.setName ?? "—"}</Text>
      <Text style={styles.row}>Numéro : {analysis.product.collectorNumber ?? "—"}</Text>
      <Text style={styles.row}>Confiance : {analysis.confidence !== null ? `${Math.round(analysis.confidence * 100)}%` : "—"}</Text>
      <Text style={styles.row}>
        Estimation :{" "}
        {analysis.valuation.low !== null && analysis.valuation.high !== null
          ? `${analysis.valuation.low}–${analysis.valuation.high} ${analysis.valuation.currency}`
          : "indisponible"}
      </Text>
      {analysis.missingInformation.length > 0 && (
        <Text style={styles.row}>Informations manquantes : {analysis.missingInformation.join(", ")}</Text>
      )}
      {analysis.risks.length > 0 && <Text style={styles.warning}>{analysis.risks.join(" — ")}</Text>}
      {analysis.analysisId && <Text style={styles.debug}>ID d'analyse : {analysis.analysisId}</Text>}
      <Button title="Nouvelle capture" onPress={() => dispatch({ type: "RESET" })} />
      <Button title="Quitter" onPress={onExit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  row: { fontSize: 14 },
  warning: { color: "#b45309", marginTop: 8 },
  error: { color: "#b91c1c" },
  debug: { fontFamily: "monospace", fontSize: 11, color: "#666", marginTop: 8 },
});
