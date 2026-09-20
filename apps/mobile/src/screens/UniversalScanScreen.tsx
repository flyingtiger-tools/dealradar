import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { CategorySlug } from "@dealradar/contracts";
import { UniversalCaptureScreen } from "../capture/UniversalCaptureScreen";
import type { QualityWarningCode } from "../capture/types";
import { identifyCapture } from "../identification/identify-capture";
import { genericObjectAdapters } from "../identification/generic-object-adapter";
import { betaResultReducer, initialBetaResultState, type BetaResultState } from "../identification/beta-result-state";
import { PreviewScreen } from "./scanner/PreviewScreen";
import { AnalysisLoadingScreen } from "./scanner/AnalysisLoadingScreen";
import { ResultScreen } from "./result/ResultScreen";
import { mapRafAnalysisToViewModel } from "./result/from-raf-analysis-view-model";
import { saveAnalysisResultToHistory } from "../history/save-result";
import type { HistoryEntry } from "../history/types";
import { ErrorState } from "../components/errors/ErrorState";
import { AppButton } from "../components/ui/AppButton";
import { colors, spacing } from "../theme/tokens";

/**
 * Écran de scan pour toute catégorie NON-TCG (LOT "rendre le scan universel
 * accessible dans l'app") — même structure que `TcgScanScreen.tsx`
 * (photo/import -> aperçu -> analyse -> résultat -> historique), mais
 * construit sur l'abstraction `identifyCapture()`/`CategoryAdapter` (ADR
 * 0013) plutôt que de dupliquer les appels réseau : réutilise
 * `genericObjectAdapters` (`identification/generic-object-adapter.ts`),
 * jamais `tcgAdapter` (routage strict, voir `ScannerEntryScreen.tsx` —
 * `pokemon_tcg` ne passe jamais par cet écran).
 *
 * `TcgScanScreen.tsx` reste inchangé et continue de gérer `pokemon_tcg`
 * seul : cet écran ne le remplace pas, il couvre les 9 autres catégories
 * avec le MÊME `ResultScreen`, la MÊME sauvegarde d'historique
 * (`saveAnalysisResultToHistory`, déjà générique depuis le lot précédent).
 */

const WARNING_LABELS: Record<QualityWarningCode, string> = {
  LOW_RESOLUTION: "Résolution insuffisante",
  POSSIBLE_BLUR: "Photo peut-être floue",
  LOW_LIGHT: "Lumière faible",
  OBJECT_TOO_SMALL_IN_FRAME: "Objet trop petit dans le cadre",
  POSSIBLE_ROTATION: "Orientation possiblement incorrecte",
};

export interface UniversalScanScreenProps {
  category: Exclude<CategorySlug, "pokemon_tcg">;
  /** Retour à la sélection de catégorie (LOT "rendre le scan universel accessible") — jamais un `RESET` qui resterait silencieusement sur la même catégorie. */
  onExit: () => void;
}

export function UniversalScanScreen({ category, onExit }: UniversalScanScreenProps) {
  const [state, setState] = useState<BetaResultState>(initialBetaResultState);
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

  // Persistance de l'historique — même schéma que `TcgScanScreen.tsx` : une
  // seule sauvegarde par résultat, jamais bloquante pour l'affichage.
  const savedAnalysisIdRef = useRef<string | null>(null);
  const [savedEntry, setSavedEntry] = useState<HistoryEntry | null | undefined>(undefined);
  useEffect(() => {
    if (state.phase !== "result") return;
    const analysisId = state.analysis.analysisId ?? "";
    if (savedAnalysisIdRef.current === analysisId) return;
    savedAnalysisIdRef.current = analysisId;
    setSavedEntry(undefined);
    void saveAnalysisResultToHistory(mapRafAnalysisToViewModel(state.analysis, category)).then(setSavedEntry);
  }, [state, category]);

  const handleAnalyze = useCallback(async () => {
    if (state.phase !== "preview") return;
    const { capture } = state;
    dispatch({ type: "ANALYSIS_STARTED" });
    try {
      const analysis = await identifyCapture(capture, category, genericObjectAdapters, (phase) => dispatch({ type: "PROGRESS", phase }));
      dispatch({ type: "ANALYSIS_SUCCEEDED", analysis });
    } catch (e) {
      dispatch({ type: "ANALYSIS_FAILED", message: e instanceof Error ? e.message : "Erreur inconnue lors de l'identification." });
    }
  }, [state, category, dispatch]);

  if (state.phase === "idle") {
    return (
      <View style={styles.root}>
        <UniversalCaptureScreen onCaptured={(capture) => dispatch({ type: "CAPTURED", capture })} onCancel={onExit} />
      </View>
    );
  }

  if (state.phase === "preview") {
    const { capture } = state;
    const previewUri = capture.detectedRegions[0]?.crop.uri ?? capture.normalizedImage.uri;
    const warnings = capture.warnings.map((code) => WARNING_LABELS[code]);
    return (
      <View style={styles.root}>
        <PreviewScreen imageUri={previewUri} warnings={warnings} onRetake={() => dispatch({ type: "RETAKE" })} onAnalyze={() => void handleAnalyze()} />
      </View>
    );
  }

  if (state.phase === "uploading" || state.phase === "submitting" || state.phase === "polling") {
    // `submitting` (création de l'analyse, avant le polling) partage l'écran
    // "uploading" — aucune étape "Identification / Marché / Prix" distincte
    // affichée séparément (même règle que `AnalysisLoadingScreen`, le
    // backend ne rapporte pas ces sous-étapes au client).
    return (
      <View style={styles.root}>
        <AnalysisLoadingScreen phase={state.phase === "polling" ? "polling" : "uploading"} />
      </View>
    );
  }

  if (state.phase === "error") {
    return (
      <View style={styles.root}>
        <ErrorState source={{ kind: "message", raw: state.message }} onRetry={() => dispatch({ type: "RETAKE" })} retryLabel="Reprendre une photo" />
        <AppButton title="Changer de catégorie" onPress={onExit} variant="ghost" style={styles.exitButton} />
      </View>
    );
  }

  const view = mapRafAnalysisToViewModel(state.analysis, category);
  return (
    <View style={styles.root}>
      <ResultScreen
        view={view}
        onScanAnother={() => dispatch({ type: "RESET" })}
        onExit={onExit}
        historyEntryId={savedEntry?.id ?? null}
        initialFavorite={savedEntry?.favorite ?? false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  exitButton: { marginHorizontal: spacing.xl },
});
