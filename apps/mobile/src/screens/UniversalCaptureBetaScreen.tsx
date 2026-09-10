import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Button, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { UniversalCaptureScreen } from "../capture/UniversalCaptureScreen";
import type { QualityWarningCode } from "../capture/types";
import { identifyCapture } from "../identification/identify-capture";
import { tcgAdapter } from "../identification/tcg-adapter";
import { betaResultReducer, initialBetaResultState, type BetaResultState } from "../identification/beta-result-state";

/**
 * Écran bêta prouvant le flux complet ADR 0013 : Universal Capture Intake
 * -> orchestrateur d'identification minimal -> TcgAdapter -> pipeline TCG
 * existant -> résultat générique. Design volontairement minimal (pas le
 * design final Raf, pas de revente, pas d'offres alternatives) — ne
 * remplace jamais `TcgScanScreen`, qui reste le flux de référence.
 *
 * Confirmation obligatoire (ADR 0013) : une photo capturée s'arrête à
 * l'aperçu local — aucun upload, aucune requête d'analyse, aucun appel IA
 * tant que l'utilisateur n'a pas explicitement tapé "Analyser". "Reprendre
 * la photo" revient à la caméra sans jamais avoir touché le réseau.
 */

const WARNING_LABELS: Record<QualityWarningCode, string> = {
  LOW_RESOLUTION: "Résolution insuffisante",
  POSSIBLE_BLUR: "Photo peut-être floue",
  LOW_LIGHT: "Lumière faible",
  OBJECT_TOO_SMALL_IN_FRAME: "Objet trop petit dans le cadre",
  POSSIBLE_ROTATION: "Orientation possiblement incorrecte",
};

const PROGRESS_LABELS: Record<"uploading" | "submitting" | "polling", string> = {
  uploading: "Envoi de la photo…",
  submitting: "Création de l'analyse…",
  polling: "Identification et recherche des prix en cours…",
};

interface UniversalCaptureBetaScreenProps {
  onExit: () => void;
}

export function UniversalCaptureBetaScreen({ onExit }: UniversalCaptureBetaScreenProps) {
  const [state, setState] = useState<BetaResultState>(initialBetaResultState);
  // Le flux réseau (upload -> création d'analyse -> polling, jusqu'à 60s)
  // n'est pas annulable aujourd'hui côté tcgAdapter — cette ref empêche
  // seulement une mise à jour d'état après démontage de l'écran (retour
  // arrière/changement d'onglet pendant l'envoi) ; l'appel réseau déjà en
  // vol continue en arrière-plan jusqu'à son terme (limitation connue, pas
  // un appel supplémentaire déclenché ici).
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dispatch = useCallback((action: Parameters<typeof betaResultReducer>[1]) => {
    if (!mountedRef.current) return;
    setState((current) => betaResultReducer(current, action));
  }, []);

  const handleAnalyze = useCallback(async () => {
    // Garde UI en plus de la garde du reducer : seul un tap depuis "preview"
    // déclenche quoi que ce soit — un second tap pendant l'envoi ne fait
    // rien (le reducer ignore déjà un second ANALYSIS_STARTED, ceci évite
    // même de reconstruire la closure sur le mauvais état).
    if (state.phase !== "preview") return;
    const { capture } = state;
    dispatch({ type: "ANALYSIS_STARTED" });
    try {
      const analysis = await identifyCapture(capture, "pokemon_tcg", [tcgAdapter], (phase) => dispatch({ type: "PROGRESS", phase }));
      dispatch({ type: "ANALYSIS_SUCCEEDED", analysis });
    } catch (e) {
      dispatch({ type: "ANALYSIS_FAILED", message: e instanceof Error ? e.message : "Erreur inconnue lors de l'identification." });
    }
  }, [state, dispatch]);

  if (state.phase === "idle") {
    return (
      <UniversalCaptureScreen onCaptured={(capture) => dispatch({ type: "CAPTURED", capture })} onCancel={onExit} />
    );
  }

  if (state.phase === "preview") {
    const { capture } = state;
    const previewUri = capture.detectedRegions[0]?.crop.uri ?? capture.normalizedImage.uri;
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Aperçu</Text>
        <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
        {capture.warnings.length > 0 && (
          <View style={styles.warningBox}>
            {capture.warnings.map((code) => (
              <Text key={code} style={styles.warning}>
                ⚠ {WARNING_LABELS[code]}
              </Text>
            ))}
          </View>
        )}
        {capture.barcodes.length > 0 && (
          <Text style={styles.row}>Code(s)-barres détecté(s) : {capture.barcodes.map((b) => b.rawValue).join(", ")}</Text>
        )}
        <View style={styles.actions}>
          <Button title="Reprendre la photo" onPress={() => dispatch({ type: "RETAKE" })} />
          <Button title="Analyser" onPress={() => void handleAnalyze()} />
        </View>
      </ScrollView>
    );
  }

  if (state.phase === "uploading" || state.phase === "submitting" || state.phase === "polling") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>{PROGRESS_LABELS[state.phase]}</Text>
      </View>
    );
  }

  if (state.phase === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{state.message}</Text>
        <View style={styles.actions}>
          <Button title="Reprendre une photo" onPress={() => dispatch({ type: "RETAKE" })} />
          <Button title="Annuler" onPress={onExit} />
        </View>
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
  preview: { width: "100%", height: 320, backgroundColor: "#eee", borderRadius: 8 },
  warningBox: { gap: 4 },
  actions: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  warning: { color: "#b45309", marginTop: 8 },
  error: { color: "#b91c1c" },
  debug: { fontFamily: "monospace", fontSize: 11, color: "#666", marginTop: 8 },
});
