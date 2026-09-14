import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Button, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { TCG_DATASET_TAGS, type TcgDatasetTag } from "@dealradar/contracts";
import { UniversalCaptureScreen } from "../capture/UniversalCaptureScreen";
import type { QualityWarningCode } from "../capture/types";
import {
  datasetCaptureReducer,
  initialDatasetCaptureState,
  type DatasetCaptureAction,
} from "../dataset-capture/dataset-capture-state";
import { addExample, deleteExample, listExamples, updateExample } from "../dataset-capture/storage";
import { exportDataset, DatasetExportError } from "../dataset-capture/export-dataset";
import type { DatasetCaptureExample, DatasetGroundTruthDraft } from "../dataset-capture/types";
import { INTERNAL_TOOLS_ENABLED } from "../config/internal-tools";

/**
 * Outil dev "TCG Dataset Capture" (long lot local, Phase 1/12) — collecte de
 * photos TCG réelles SANS réseau, pour alimenter
 * `packages/benchmark/datasets/tcg/`. Réutilise `UniversalCaptureScreen` tel
 * quel (caméra/quality checks/crop/barcodes) — aucune logique TCG n'est
 * jamais ajoutée au module générique `../capture/`.
 *
 * Garantie architecturale (Phase 12) : ce composant n'importe jamais
 * l'adaptateur TCG ni les clients réseau du reste de l'app mobile — il ne
 * PEUT PAS déclencher une analyse ou un upload, même par erreur (voir
 * `../dataset-capture/__tests__/no-network-invariant.test.ts`, qui vérifie
 * mécaniquement cette propriété sur ce fichier ET sur tout le dossier
 * `dataset-capture/`).
 * Double garde : `INTERNAL_TOOLS_ENABLED` ci-dessous ET le fait que l'onglet
 * qui rend ce composant n'est lui-même ajouté à `App.tsx` que sous ce même
 * flag — vrai en Development Build (`__DEV__`) ou dans le build interne
 * autonome dédié, jamais dans un build grand public.
 */

const WARNING_LABELS: Record<QualityWarningCode, string> = {
  LOW_RESOLUTION: "Résolution insuffisante",
  POSSIBLE_BLUR: "Photo peut-être floue",
  LOW_LIGHT: "Lumière faible",
  OBJECT_TOO_SMALL_IN_FRAME: "Objet trop petit dans le cadre",
  POSSIBLE_ROTATION: "Orientation possiblement incorrecte",
};

const PRODUCT_KINDS: { value: DatasetGroundTruthDraft["productKind"]; label: string }[] = [
  { value: null, label: "Non précisé" },
  { value: "raw_card", label: "Carte brute" },
  { value: "graded_card", label: "Carte gradée" },
];

interface TcgDatasetCaptureToolProps {
  onExit: () => void;
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function GroundTruthForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  submitting,
}: {
  draft: DatasetGroundTruthDraft;
  onChange: (draft: DatasetGroundTruthDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  submitting: boolean;
}) {
  const set = <K extends keyof DatasetGroundTruthDraft>(key: K, value: DatasetGroundTruthDraft[K]) => onChange({ ...draft, [key]: value });
  const toggleTag = (tag: TcgDatasetTag) => {
    const next = draft.tags.includes(tag) ? draft.tags.filter((t) => t !== tag) : [...draft.tags, tag];
    set("tags", next);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Nom de la carte *</Text>
      <TextInput style={styles.input} value={draft.cardName} onChangeText={(v) => set("cardName", v)} placeholder="ex. Nymble" />

      <Text style={styles.label}>Set</Text>
      <TextInput style={styles.input} value={draft.setName ?? ""} onChangeText={(v) => set("setName", nullable(v))} placeholder="ex. Phantasmal Flames" />

      <Text style={styles.label}>Numéro de collection (tel qu'imprimé — garder le padding réel)</Text>
      <TextInput style={styles.input} value={draft.collectorNumber ?? ""} onChangeText={(v) => set("collectorNumber", nullable(v))} placeholder="ex. 096" />

      <Text style={styles.label}>Langue</Text>
      <TextInput style={styles.input} value={draft.language ?? ""} onChangeText={(v) => set("language", nullable(v))} placeholder="ex. en, fr" />

      <Text style={styles.label}>Variante</Text>
      <TextInput style={styles.input} value={draft.variant ?? ""} onChangeText={(v) => set("variant", nullable(v))} placeholder="ex. Illustration Rare" />

      <Text style={styles.label}>Type de produit</Text>
      <View style={styles.chipsRow}>
        {PRODUCT_KINDS.map((kind) => (
          <Pressable
            key={kind.label}
            onPress={() => set("productKind", kind.value)}
            style={[styles.chip, draft.productKind === kind.value && styles.chipActive]}
          >
            <Text style={[styles.chipText, draft.productKind === kind.value && styles.chipTextActive]}>{kind.label}</Text>
          </Pressable>
        ))}
      </View>

      {draft.productKind === "graded_card" && (
        <>
          <Text style={styles.label}>Société de gradation</Text>
          <TextInput style={styles.input} value={draft.gradingCompany ?? ""} onChangeText={(v) => set("gradingCompany", nullable(v))} placeholder="ex. PSA" />
          <Text style={styles.label}>Grade</Text>
          <TextInput style={styles.input} value={draft.grade ?? ""} onChangeText={(v) => set("grade", nullable(v))} placeholder="ex. 10" />
        </>
      )}

      <Text style={styles.label}>Notes</Text>
      <TextInput style={[styles.input, styles.notes]} value={draft.notes} onChangeText={(v) => set("notes", v)} multiline placeholder="Contexte libre" />

      <Text style={styles.label}>Tags de difficulté/qualité</Text>
      <View style={styles.chipsRow}>
        {TCG_DATASET_TAGS.map((tag) => (
          <Pressable key={tag} onPress={() => toggleTag(tag)} style={[styles.chip, draft.tags.includes(tag) && styles.chipActive]}>
            <Text style={[styles.chipText, draft.tags.includes(tag) && styles.chipTextActive]}>{tag}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.actions}>
        <Button title="Annuler" onPress={onCancel} disabled={submitting} />
        <Button title={submitting ? "Enregistrement…" : submitLabel} onPress={onSubmit} disabled={submitting || draft.cardName.trim() === ""} />
      </View>
    </View>
  );
}

export function TcgDatasetCaptureTool({ onExit }: TcgDatasetCaptureToolProps) {
  const [innerTab, setInnerTab] = useState<"capture" | "library">("capture");
  const [state, dispatch] = useState(initialDatasetCaptureState);
  const runDispatch = useCallback((action: DatasetCaptureAction) => dispatch((current) => datasetCaptureReducer(current, action)), []);

  const [examples, setExamples] = useState<DatasetCaptureExample[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      setExamples(await listExamples());
      setLibraryError(null);
    } catch (e) {
      setLibraryError(e instanceof Error ? e.message : "Erreur inconnue lors du chargement de la bibliothèque.");
    }
  }, []);

  useEffect(() => {
    if (innerTab === "library") void refreshLibrary();
  }, [innerTab, refreshLibrary]);

  const handleSave = useCallback(async () => {
    if (state.phase !== "editingGroundTruth") return;
    runDispatch({ type: "SAVE_REQUESTED" });
    try {
      if (state.editingExampleId) {
        await updateExample(state.editingExampleId, state.draft);
        runDispatch({ type: "SAVE_SUCCEEDED", exampleId: state.editingExampleId, duplicateCandidateIds: [] });
      } else {
        const sourceUri = state.capture.detectedRegions[0]?.crop.uri ?? state.capture.normalizedImage.uri;
        const { example, duplicateCandidateIds } = await addExample({
          sourceImageUri: sourceUri,
          qualityWarnings: state.capture.warnings,
          qualitySignals: state.capture.qualitySignals,
          orientation: state.capture.orientation,
          groundTruth: state.draft,
        });
        runDispatch({ type: "SAVE_SUCCEEDED", exampleId: example.id, duplicateCandidateIds });
      }
    } catch (e) {
      runDispatch({ type: "SAVE_FAILED", message: e instanceof Error ? e.message : "Erreur inconnue lors de la sauvegarde locale." });
    }
  }, [state, runDispatch]);

  const handleDelete = useCallback(
    (example: DatasetCaptureExample) => {
      Alert.alert("Supprimer cet exemple ?", `"${example.groundTruth.cardName}" — cette action est irréversible.`, [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => {
            void deleteExample(example.id)
              .then(refreshLibrary)
              .catch((e) => setLibraryError(e instanceof Error ? e.message : "Erreur lors de la suppression."));
          },
        },
      ]);
    },
    [refreshLibrary],
  );

  const handleEdit = useCallback(
    (example: DatasetCaptureExample) => {
      // Réutilise `UniversalCaptureResult` déjà stocké au moment de la capture — jamais de re-capture pour éditer la vérité terrain seule.
      const fakeCapture = {
        captureType: "camera" as const,
        normalizedImage: { uri: example.localImageUri, width: example.qualitySignals.originalWidth, height: example.qualitySignals.originalHeight, format: "jpeg" as const },
        detectedRegions: [],
        barcodes: [],
        orientation: example.orientation,
        qualitySignals: example.qualitySignals,
        warnings: example.qualityWarnings,
      };
      runDispatch({ type: "START_EDIT_EXISTING", capture: fakeCapture, draft: example.groundTruth, exampleId: example.id });
      setInnerTab("capture");
    },
    [runDispatch],
  );

  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await exportDataset();
      Alert.alert(
        "Export terminé",
        `${result.fileName} — ${result.exampleCount} exemple(s).\n\n${
          result.savedToUserFolder
            ? "Déposé dans le dossier choisi."
            : `Non déposé dans un dossier choisi (permission refusée ou plateforme non Android) — fichier toujours disponible en interne :\n${result.internalPath}`
        }`,
      );
    } catch (e) {
      Alert.alert("Export impossible", e instanceof DatasetExportError ? e.message : "Erreur inconnue lors de l'export.");
    } finally {
      setExporting(false);
    }
  }, []);

  // Garde défensive supplémentaire (double du filtrage déjà fait par l'appelant — voir
  // le commentaire de fichier ci-dessus) — jamais rendu si le bundle tournait par erreur
  // hors dev/build interne. Placée après tous les Hooks (jamais avant un retour
  // conditionnel) : `INTERNAL_TOOLS_ENABLED` est fixé à la compilation (constante
  // `__DEV__` ou variable d'environnement inlinée), donc l'ordre des Hooks reste stable
  // d'un rendu à l'autre malgré ce retour anticipé.
  if (!INTERNAL_TOOLS_ENABLED) return null;

  const tabBar = (
    <View style={styles.tabBar}>
      <Button title="Capturer" onPress={() => setInnerTab("capture")} disabled={innerTab === "capture"} />
      <Button title={`Bibliothèque${examples ? ` (${examples.length})` : ""}`} onPress={() => setInnerTab("library")} disabled={innerTab === "library"} />
      <Button title="Quitter" onPress={onExit} />
    </View>
  );

  if (innerTab === "library") {
    return (
      <View style={styles.container}>
        {tabBar}
        <ScrollView contentContainerStyle={styles.libraryList}>
          <Button title={exporting ? "Export en cours…" : "Exporter le dataset (.zip)"} onPress={() => void handleExport()} disabled={exporting || !examples || examples.length === 0} />
          {libraryError && <Text style={styles.error}>{libraryError}</Text>}
          {examples === null && <ActivityIndicator />}
          {examples?.length === 0 && <Text style={styles.hint}>Aucun exemple enregistré — capture ta première photo dans l'onglet "Capturer".</Text>}
          {examples?.map((example) => (
            <View key={example.id} style={styles.libraryRow}>
              <Image source={{ uri: example.localImageUri }} style={styles.thumbnail} resizeMode="cover" />
              <View style={styles.libraryRowInfo}>
                <Text style={styles.libraryRowTitle}>{example.groundTruth.cardName}</Text>
                <Text style={styles.libraryRowSubtitle}>
                  {[example.groundTruth.setName, example.groundTruth.collectorNumber].filter(Boolean).join(" — ") || "Sans set/numéro"}
                </Text>
                {example.groundTruth.tags.length > 0 && <Text style={styles.libraryRowTags}>{example.groundTruth.tags.join(", ")}</Text>}
              </View>
              <View style={styles.libraryRowActions}>
                <Button title="Éditer" onPress={() => handleEdit(example)} />
                <Button title="Suppr." color="#b91c1c" onPress={() => handleDelete(example)} />
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (state.phase === "idle") {
    return (
      <View style={styles.container}>
        {tabBar}
        <UniversalCaptureScreen onCaptured={(capture) => runDispatch({ type: "CAPTURED", capture })} onCancel={onExit} />
      </View>
    );
  }

  if (state.phase === "preview") {
    const { capture } = state;
    const previewUri = capture.detectedRegions[0]?.crop.uri ?? capture.normalizedImage.uri;
    return (
      <View style={styles.container}>
        {tabBar}
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
          <View style={styles.actions}>
            <Button title="Reprendre la photo" onPress={() => runDispatch({ type: "RETAKE" })} />
            <Button title="Continuer" onPress={() => runDispatch({ type: "CONTINUE_TO_EDIT" })} />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (state.phase === "editingGroundTruth" || state.phase === "saving" || state.phase === "error") {
    return (
      <View style={styles.container}>
        {tabBar}
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>{state.editingExampleId ? "Modifier l'exemple" : "Vérité terrain"}</Text>
          {state.phase === "error" && <Text style={styles.error}>{state.message}</Text>}
          <GroundTruthForm
            draft={state.draft}
            onChange={(draft) => runDispatch({ type: "UPDATE_DRAFT", draft })}
            onSubmit={() => void handleSave()}
            onCancel={() => runDispatch({ type: "RETAKE" })}
            submitLabel={state.editingExampleId ? "Enregistrer les modifications" : "Enregistrer"}
            submitting={state.phase === "saving"}
          />
        </ScrollView>
      </View>
    );
  }

  // state.phase === "saved"
  return (
    <View style={styles.container}>
      {tabBar}
      <View style={styles.center}>
        <Text style={styles.title}>Exemple enregistré</Text>
        {state.duplicateCandidateIds.length > 0 && (
          <Text style={styles.warning}>
            ⚠ {state.duplicateCandidateIds.length} exemple(s) déjà enregistré(s) semblent identiques (même nom/set/numéro/variante) — vérifie la bibliothèque pour éviter un doublon involontaire.
          </Text>
        )}
        <View style={styles.actions}>
          <Button title="Nouvelle capture" onPress={() => runDispatch({ type: "RESET" })} />
          <Button title="Voir la bibliothèque" onPress={() => { runDispatch({ type: "RESET" }); setInnerTab("library"); }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  tabBar: { flexDirection: "row", gap: 8, padding: 12, flexWrap: "wrap" },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  hint: { fontSize: 14, color: "#666", padding: 12 },
  preview: { width: "100%", height: 320, backgroundColor: "#eee", borderRadius: 8 },
  warningBox: { gap: 4 },
  warning: { color: "#b45309", marginTop: 8 },
  error: { color: "#b91c1c" },
  actions: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginTop: 12 },
  form: { gap: 4, paddingBottom: 24 },
  label: { fontSize: 12, fontWeight: "600", color: "#444", marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8, fontSize: 14 },
  notes: { minHeight: 60, textAlignVertical: "top" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 4, paddingHorizontal: 10 },
  chipActive: { backgroundColor: "#1d4ed8", borderColor: "#1d4ed8" },
  chipText: { fontSize: 12, color: "#333" },
  chipTextActive: { color: "#fff" },
  libraryList: { padding: 12, gap: 8 },
  libraryRow: { flexDirection: "row", gap: 8, alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#eee", paddingVertical: 8 },
  thumbnail: { width: 56, height: 56, borderRadius: 6, backgroundColor: "#eee" },
  libraryRowInfo: { flex: 1, gap: 2 },
  libraryRowTitle: { fontSize: 14, fontWeight: "600" },
  libraryRowSubtitle: { fontSize: 12, color: "#666" },
  libraryRowTags: { fontSize: 11, color: "#1d4ed8" },
  libraryRowActions: { gap: 4 },
});
