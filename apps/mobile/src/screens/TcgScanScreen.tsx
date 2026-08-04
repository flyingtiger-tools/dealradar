import { useCallback, useState } from "react";
import { ActivityIndicator, Button, Image, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import type { TcgCardProvidedHints } from "@dealradar/contracts";
import { tcgScanReducer, initialTcgScanState, type TcgScanState } from "../state/tcg-scan-state";
import { uploadTcgCardPhoto, deleteTcgCardPhoto } from "../api/tcg-upload-client";
import { createAnalysis, pollAnalysisUntilSettled } from "../api/analyses-client";

/**
 * Écran de scan photo carte Pokémon (LOT 8, authentification réelle LOT 9)
 * — flux : photo/import -> upload -> soumission -> résultat, avec un écran
 * de confirmation uniquement quand l'extraction visuelle hésite (jamais un
 * formulaire manuel par défaut). Le jeton d'accès n'est plus un paramètre
 * ici : `analyses-client.ts`/`tcg-upload-client.ts` le tirent automatiquement
 * de la session Supabase courante (`auth/session.ts`) — cet écran n'est
 * jamais monté sans session active (`App.tsx` affiche `LoginScreen` sinon).
 */

const CONSENT_VERSION = "1";

const CONFIRMATION_FIELDS: { key: keyof TcgCardProvidedHints; label: string }[] = [
  { key: "cardName", label: "Nom de la carte" },
  { key: "setName", label: "Set / extension" },
  { key: "cardNumber", label: "Numéro" },
  { key: "variant", label: "Variante" },
  { key: "language", label: "Langue" },
  { key: "gradingCompany", label: "Société de gradation" },
  { key: "grade", label: "Note" },
];

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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Scanner une carte Pokémon</Text>

      {(state.phase === "idle" || state.phase === "error") && (
        <View style={styles.captureGuide}>
          {/* Repère visuel statique (aucune dépendance caméra native, LOT 8A) — aide à cadrer avant d'ouvrir l'appareil photo natif, ne contraint rien techniquement. */}
          <View style={styles.cardFrame} />
          <Text style={styles.captureInstruction}>Carte bien droite, sans reflet, numéro du bas lisible</Text>
          <View style={styles.actions}>
            <Button title="Prendre une photo" onPress={pickFromCamera} />
            <Button title="Choisir depuis la galerie" onPress={pickFromGallery} />
          </View>
        </View>
      )}

      {state.phase === "error" && <Text style={styles.error}>{state.message}</Text>}

      {state.phase === "previewingImage" && (
        <View style={styles.previewBox}>
          <Image source={{ uri: state.imageUri }} style={styles.preview} />
          <View style={styles.actions}>
            <Button title="Annuler" onPress={() => dispatch({ type: "CANCELLED" })} />
            <Button title="Analyser" onPress={submitScan} />
          </View>
        </View>
      )}

      {(state.phase === "uploading" || state.phase === "polling" || state.phase === "resubmitting") && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
          <Text>
            {state.phase === "uploading" ? "Envoi de la photo…" : "Identification et recherche des prix en cours…"}
          </Text>
        </View>
      )}

      {state.phase === "needsConfirmation" && (
        <View style={styles.confirmBox}>
          <Text style={styles.subtitle}>Confirme ou corrige les champs détectés</Text>
          {CONFIRMATION_FIELDS.map(({ key, label }) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{label}</Text>
              <TextInput
                style={styles.input}
                placeholder={label}
                value={state.fields[key] ?? ""}
                onChangeText={(text) => dispatch({ type: "CONFIRMATION_FIELD_CHANGED", field: key, value: text.length > 0 ? text : null })}
              />
            </View>
          ))}
          <Button title="Rechercher avec ces informations" onPress={resubmitWithCorrections} />
        </View>
      )}

      {state.phase === "result" && (
        <TcgScanResultView status={state.status} result={state.result} onScanAnother={() => dispatch({ type: "RESET" })} />
      )}
    </ScrollView>
  );
}

function TcgScanResultView({
  status,
  result,
  onScanAnother,
}: {
  status: "completed" | "insufficient_data" | "failed";
  result: import("@dealradar/contracts").TcgCardAnalysisResult | null;
  onScanAnother: () => void;
}) {
  if (status !== "completed" || !result || !result.identity) {
    return (
      <View style={styles.resultBox}>
        <Text style={styles.subtitle}>Données insuffisantes</Text>
        <Text>{result?.reason ?? "Identification impossible avec les informations disponibles."}</Text>
        {result?.warnings.map((w, i) => (
          <Text key={i} style={styles.warning}>
            {w}
          </Text>
        ))}
        <Button title="Nouveau scan" onPress={onScanAnother} />
      </View>
    );
  }

  const { identity, priceObservations, warnings } = result;

  return (
    <View style={styles.resultBox}>
      <Text style={styles.subtitle}>{identity.name}</Text>
      <Text>
        {identity.setName ?? "Set inconnu"} {identity.cardNumber ? `#${identity.cardNumber}` : ""}
      </Text>
      <Text>
        {identity.variant ?? "Variante non départagée"} · {identity.language ?? "Langue non confirmée"} ·{" "}
        {identity.productKind === "graded_card" ? `Gradé ${identity.gradingCompany ?? ""} ${identity.grade ?? ""}` : "Brut"}
      </Text>
      <Text>Confiance identité : {Math.round(identity.confidence * 100)}%</Text>

      <Text style={styles.subtitle}>Prix par source</Text>
      {priceObservations.map((obs, i) => (
        <View key={i} style={styles.priceRow}>
          <Text>
            {obs.source} · {(obs.amountCents / 100).toFixed(2)} {obs.currency}
            {obs.condition ? ` · ${obs.condition}` : ""}
          </Text>
          {obs.conversion && (
            <Text style={styles.conversion}>
              ≈ {(obs.conversion.convertedAmountCents / 100).toFixed(2)} {obs.conversion.convertedCurrency} (indicatif)
            </Text>
          )}
        </View>
      ))}

      {warnings.map((w, i) => (
        <Text key={i} style={styles.warning}>
          {w}
        </Text>
      ))}

      <Button title="Nouveau scan" onPress={onScanAnother} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: "600" },
  subtitle: { fontSize: 16, fontWeight: "600", marginTop: 12 },
  actions: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  captureGuide: { gap: 12, alignItems: "center" },
  // Proportions carte TCG standard (63mm x 88mm ≈ 0.716) — repère visuel uniquement, aucun cadrage forcé.
  cardFrame: { width: 172, height: 240, borderWidth: 2, borderColor: "#999", borderStyle: "dashed", borderRadius: 12 },
  captureInstruction: { fontSize: 13, color: "#444", textAlign: "center" },
  error: { color: "#b91c1c" },
  warning: { color: "#b45309", fontSize: 12 },
  previewBox: { gap: 8 },
  preview: { width: "100%", height: 240, resizeMode: "contain", backgroundColor: "#eee" },
  loading: { alignItems: "center", gap: 8, paddingVertical: 24 },
  confirmBox: { gap: 8 },
  fieldRow: { gap: 4 },
  fieldLabel: { fontSize: 12, color: "#666" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
  resultBox: { gap: 4 },
  priceRow: { paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ddd" },
  conversion: { fontSize: 12, color: "#666" },
});
