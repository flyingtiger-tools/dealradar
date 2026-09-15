import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { tcgScanReducer, initialTcgScanState, type TcgScanState } from "../state/tcg-scan-state";
import { uploadTcgCardPhoto, deleteTcgCardPhoto } from "../api/tcg-upload-client";
import { createAnalysis, pollAnalysisUntilSettled } from "../api/analyses-client";
import { analyzeTcgCard } from "../api/tcg-analyze-client";
import { INTERNAL_TOOLS_ENABLED } from "../config/internal-tools";
import { CaptureGuideScreen } from "./scanner/CaptureGuideScreen";
import { PreviewScreen } from "./scanner/PreviewScreen";
import { AnalysisLoadingScreen } from "./scanner/AnalysisLoadingScreen";
import { ConfirmationFormScreen } from "./scanner/ConfirmationFormScreen";
import { ResultScreen } from "./result/ResultScreen";
import { mapTcgResultToViewModel } from "./result/result-view-model";
import { colors } from "../theme/tokens";

/**
 * Écran de scan photo carte Pokémon (LOT 8, authentification réelle LOT 9)
 * — flux : photo/import -> upload -> soumission -> résultat, avec un écran
 * de confirmation uniquement quand l'extraction visuelle hésite (jamais un
 * formulaire manuel par défaut). Le jeton d'accès n'est plus un paramètre
 * ici : `analyses-client.ts`/`tcg-upload-client.ts` le tirent automatiquement
 * de la session Supabase courante (`auth/session.ts`) — cet écran n'est
 * jamais monté sans session active (`App.tsx` affiche `LoginScreen` sinon).
 *
 * Deux chemins réseau, choisis via `INTERNAL_TOOLS_ENABLED` (lot "journée
 * autonome", Priorité 7/8) : en build interne, `analyzeTcgCard()` appelle
 * `POST /api/internal/tcg/analyze` (Vercel, synchrone, aucun worker requis)
 * — sinon `createAnalysis()` + `pollAnalysisUntilSettled()` (file d'attente
 * `pg-boss` + worker Railway, chemin de production future, JAMAIS supprimé).
 * Le worker Railway étant hors ligne (trial expiré, jamais payé), le chemin
 * interne est aujourd'hui le seul qui aboutit réellement.
 */

const CONSENT_VERSION = "1";

export function TcgScanScreen() {
  const [state, setState] = useState<TcgScanState>(initialTcgScanState);
  const dispatch = useCallback((action: Parameters<typeof tcgScanReducer>[1]) => {
    setState((current) => tcgScanReducer(current, action));
  }, []);

  const pickFromCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 1, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled && result.assets[0]) dispatch({ type: "IMAGE_SELECTED", imageUri: result.assets[0].uri });
  }, [dispatch]);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 1, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled && result.assets[0]) dispatch({ type: "IMAGE_SELECTED", imageUri: result.assets[0].uri });
  }, [dispatch]);

  const submitScan = useCallback(async () => {
    if (state.phase !== "previewingImage") return;
    // Suivi explicite : dès que l'upload réussit, la photo doit être
    // nettoyée quoi qu'il arrive ensuite (succès ou échec plus loin dans le
    // flux) — jamais conservée au-delà de ce qui est nécessaire (règle LOT 8).
    let uploaded = false;
    let clientRequestId = "";
    // Tout le corps est dans le try — y compris la génération de l'id et le
    // dispatch initial : une exception synchrone ici (ex. `crypto.randomUUID`
    // indisponible sur certains runtimes RN/Hermes, cause réelle rencontrée)
    // ne doit jamais échouer silencieusement sans retour visible à l'écran.
    try {
      clientRequestId = Crypto.randomUUID();
      dispatch({ type: "UPLOAD_STARTED" });
      const { url } = await uploadTcgCardPhoto(clientRequestId, state.imageUri);
      uploaded = true;

      if (INTERNAL_TOOLS_ENABLED) {
        dispatch({ type: "SUBMIT_STARTED", requestId: clientRequestId });
        const { status, result } = await analyzeTcgCard({ imageUrl: url });
        void deleteTcgCardPhoto(clientRequestId);
        dispatch({ type: "RESULT_RECEIVED", result, status });
        return;
      }

      const created = await createAnalysis({
        sourceType: "mobile_camera",
        sourcePlatform: null,
        sharedUrl: null,
        title: null,
        description: null,
        categorySlug: "pokemon_tcg",
        purchasePrice: null,
        currency: "CHF",
        imageReferences: [{ url }],
        consentVersion: CONSENT_VERSION,
        clientRequestId,
        providedTcgHints: null,
      });
      dispatch({ type: "SUBMIT_STARTED", requestId: created.id });
      const settled = await pollAnalysisUntilSettled(created.id);
      void deleteTcgCardPhoto(clientRequestId);
      dispatch({
        type: "RESULT_RECEIVED",
        result: settled.result && "kind" in settled.result ? settled.result : null,
        status: settled.status === "completed" || settled.status === "insufficient_data" || settled.status === "failed" ? settled.status : "failed",
      });
    } catch (e) {
      // Best-effort : un échec de suppression n'empêche jamais d'afficher
      // l'erreur réelle à l'utilisateur (voir `deleteTcgCardPhoto`).
      if (uploaded) void deleteTcgCardPhoto(clientRequestId);
      dispatch({ type: "FAILED", message: e instanceof Error ? e.message : "Erreur inconnue lors de l'envoi." });
    }
  }, [state, dispatch]);

  const resubmitWithCorrections = useCallback(async () => {
    if (state.phase !== "needsConfirmation") return;
    dispatch({ type: "CONFIRMATION_SUBMITTED" });
    try {
      if (INTERNAL_TOOLS_ENABLED) {
        const { status, result } = await analyzeTcgCard({ providedTcgHints: state.fields });
        dispatch({ type: "RESULT_RECEIVED", result, status });
        return;
      }

      const created = await createAnalysis({
        sourceType: "mobile_camera",
        sourcePlatform: null,
        sharedUrl: null,
        title: null,
        description: null,
        categorySlug: "pokemon_tcg",
        purchasePrice: null,
        currency: "CHF",
        imageReferences: [],
        consentVersion: CONSENT_VERSION,
        clientRequestId: Crypto.randomUUID(),
        providedTcgHints: state.fields,
      });
      dispatch({ type: "SUBMIT_STARTED", requestId: created.id });
      const settled = await pollAnalysisUntilSettled(created.id);
      dispatch({
        type: "RESULT_RECEIVED",
        result: settled.result && "kind" in settled.result ? settled.result : null,
        status: settled.status === "completed" || settled.status === "insufficient_data" || settled.status === "failed" ? settled.status : "failed",
      });
    } catch (e) {
      dispatch({ type: "FAILED", message: e instanceof Error ? e.message : "Erreur inconnue lors de l'envoi." });
    }
  }, [state, dispatch]);

  // Présentation uniquement à partir d'ici — aucun des branchements
  // ci-dessus (pickFromCamera/pickFromGallery/submitScan/
  // resubmitWithCorrections/dispatch) n'est touché : cet écran délègue
  // seulement le RENDU à des composants présentationnels dédiés
  // (Phase 1/5/6/7/8, LOT "fondation produit Raf") — même state machine,
  // mêmes appels réseau qu'avant ce lot.
  if (state.phase === "idle" || state.phase === "error") {
    return (
      <View style={styles.root}>
        <CaptureGuideScreen
          errorMessage={state.phase === "error" ? state.message : null}
          onTakePhoto={pickFromCamera}
          onPickFromGallery={pickFromGallery}
          onManualEntry={() => dispatch({ type: "MANUAL_ENTRY_STARTED" })}
        />
      </View>
    );
  }

  if (state.phase === "previewingImage") {
    return (
      <View style={styles.root}>
        <PreviewScreen imageUri={state.imageUri} onRetake={() => dispatch({ type: "CANCELLED" })} onAnalyze={submitScan} />
      </View>
    );
  }

  if (state.phase === "uploading" || state.phase === "polling" || state.phase === "resubmitting") {
    return (
      <View style={styles.root}>
        <AnalysisLoadingScreen phase={state.phase === "uploading" ? "uploading" : "polling"} />
      </View>
    );
  }

  if (state.phase === "needsConfirmation") {
    return (
      <View style={styles.root}>
        <ConfirmationFormScreen
          isManualEntry={state.requestId === ""}
          fields={state.fields}
          onFieldChange={(field, value) => dispatch({ type: "CONFIRMATION_FIELD_CHANGED", field, value })}
          onSubmit={resubmitWithCorrections}
        />
      </View>
    );
  }

  if (state.phase === "result") {
    return (
      <View style={styles.root}>
        <ResultScreen view={mapTcgResultToViewModel(state.result, state.status)} onScanAnother={() => dispatch({ type: "RESET" })} />
      </View>
    );
  }

  // `state.phase === "submitting"` : jamais réellement atteint (le reducer
  // transitionne "uploading" -> "polling" directement, voir
  // `tcg-scan-state.ts`) — présent dans le type par exhaustivité seulement.
  // Repli défensif identique à l'écran de chargement plutôt qu'un écran vide.
  return (
    <View style={styles.root}>
      <AnalysisLoadingScreen phase="uploading" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
