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
import { ProductHistoryScreen } from "./result/ProductHistoryScreen";
import { mapRafAnalysisToViewModel } from "./result/from-raf-analysis-view-model";
import { saveAnalysisResultToHistory } from "../history/save-result";
import { cancelAnalysis } from "../api/analyses-client";
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
  // Navigation locale "Voir l'historique" (LOT "Product History UX + Source
  // Health + Interactive Cancellation + Beta Readiness", section 2) — un
  // simple bascule d'écran, même patron que le reste de cet écran (pas de
  // pile de navigation partagée pour ce flux). Réinitialisé à `null` dès
  // qu'un nouveau scan démarre (`RESET`), jamais conservé d'un résultat à
  // l'autre.
  const [productHistoryOpen, setProductHistoryOpen] = useState(false);
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

  // Annulation interactive (LOT "Product History UX + Source Health +
  // Interactive Cancellation + Beta Readiness", section 6/7) —
  // `abortControllerRef` arrête IMMÉDIATEMENT le polling côté client
  // (`pollAnalysisUntilSettled({ signal })`), `pendingAnalysisIdRef` capture
  // l'identifiant serveur DÈS que `identifyCapture()` le rapporte (phase
  // "polling", voir `OnAnalysisProgress`) pour permettre un appel best-effort
  // à `cancelAnalysis()`. Les deux sont réinitialisés à chaque nouvelle
  // analyse — jamais réutilisés d'un cycle à l'autre.
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingAnalysisIdRef = useRef<string | null>(null);

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
    pendingAnalysisIdRef.current = null;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    dispatch({ type: "ANALYSIS_STARTED" });
    try {
      const analysis = await identifyCapture(
        capture,
        category,
        genericObjectAdapters,
        (phase, analysisId) => {
          if (analysisId) pendingAnalysisIdRef.current = analysisId;
          dispatch({ type: "PROGRESS", phase });
        },
        controller.signal,
      );
      dispatch({ type: "ANALYSIS_SUCCEEDED", analysis });
    } catch (e) {
      dispatch({ type: "ANALYSIS_FAILED", message: e instanceof Error ? e.message : "Erreur inconnue lors de l'identification." });
    }
  }, [state, category, dispatch]);

  // Annulation demandée par l'utilisateur (section 6/7) — revient à l'état
  // local `idle` IMMÉDIATEMENT (`RESET`, jamais une attente de confirmation
  // serveur) : toute résolution tardive de `identifyCapture()` ci-dessus
  // (succès, échec, ou levée par `signal`) sera ignorée par le réducteur
  // (garde `isInFlight`, voir `beta-result-state.ts`) puisque la phase n'est
  // déjà plus "uploading"/"submitting"/"polling". `cancelAnalysis()` est
  // best-effort : son échec (réseau, déjà terminale côté serveur, etc.) ne
  // doit jamais empêcher le retour local à l'état idle.
  const handleCancelAnalysis = useCallback(() => {
    abortControllerRef.current?.abort();
    const idToCancel = pendingAnalysisIdRef.current;
    if (idToCancel) void cancelAnalysis(idToCancel).catch(() => {});
    dispatch({ type: "RESET" });
  }, [dispatch]);

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
        <AnalysisLoadingScreen phase={state.phase === "polling" ? "polling" : "uploading"} onCancel={handleCancelAnalysis} />
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

  if (productHistoryOpen && view.productKey) {
    return (
      <View style={styles.root}>
        <ProductHistoryScreen
          productKey={view.productKey}
          productName={view.product.name}
          currentVsHistoryLabel={view.marketInsight?.currentVsHistoryLabel ?? null}
          onBack={() => setProductHistoryOpen(false)}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ResultScreen
        view={view}
        onScanAnother={() => {
          setProductHistoryOpen(false);
          dispatch({ type: "RESET" });
        }}
        onExit={onExit}
        historyEntryId={savedEntry?.id ?? null}
        initialFavorite={savedEntry?.favorite ?? false}
        onOpenProductHistory={() => setProductHistoryOpen(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  exitButton: { marginHorizontal: spacing.xl },
});
