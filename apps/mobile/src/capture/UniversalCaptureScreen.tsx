import { useCallback, useRef, useState, type ComponentType, type Ref } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type CameraMountError, type CameraViewProps } from "expo-camera";
import * as FileSystem from "expo-file-system";
import { DEFAULT_CAPTURE_GUIDE_CONFIG, type CaptureGuideConfig } from "./capture-guide-config";
import { normalizeOrientation, parseExifOrientation } from "./normalize-orientation";
import { computeAssumedRegionRect, generateGuideFrameCrop } from "./generate-crops";
import { dedupeBarcodes, SUPPORTED_BARCODE_TYPES, toDetectedBarcode } from "./barcode";
import { evaluateQuality, parseExifExposureTime, parseExifIsoSpeed, possibleRotationWarning } from "./quality-engine";
import type { DetectedBarcode, UniversalCaptureResult } from "./types";

/**
 * Écran de capture générique (LOT "Universal Capture Intake", Phase A,
 * ADR 0013) — ne connaît aucun champ Pokémon/TCG. Produit un
 * `UniversalCaptureResult` consommé par un futur adapter, jamais l'inverse.
 * Introduit derrière un onglet séparé dans `App.tsx` tant qu'il n'est pas
 * validé sur appareil réel — n'affecte jamais `TcgScanScreen`.
 *
 * N'appelle JAMAIS `CameraView.isAvailableAsync()` — trouvé et corrigé après
 * premier test sur appareil réel (Samsung S24 Ultra) : cette méthode n'est
 * implémentée QUE côté web/simulateur (voir la doc `@platform web` du
 * package `expo-camera` lui-même, et l'absence totale de l'implémentation
 * native côté Android dans `node_modules/expo-camera/android`). Sur un
 * device Android réel, elle lève systématiquement `UnavailabilityError`
 * (promesse rejetée) — sans `.catch()`, l'écran restait bloqué indéfiniment
 * sur un indicateur de chargement, quel que soit l'état réel de la caméra.
 * La vérification réelle passe par `useCameraPermissions()` (déjà en place)
 * + `onMountError` de `CameraView` (signal natif authentique, cross-
 * plateforme, déclenché seulement si le montage échoue vraiment) — jamais
 * un pré-contrôle qui invente une réponse avant même de tenter le montage.
 */

/**
 * Ce monorepo pnpm résout deux versions de `@types/react` (apps/web en 19,
 * apps/mobile en 18) pour éviter un conflit de namespace JSX global (voir
 * .npmrc). Effet de bord : la classe `CameraView` d'expo-camera échoue la
 * vérification structurelle JSX (TS2607/TS2786) bien que le comportement
 * runtime soit correct. Cast localisé à ce seul tag, sans toucher au reste
 * du fichier ni à la config workspace.
 */
const CameraViewTag = CameraView as unknown as ComponentType<CameraViewProps & { ref?: Ref<CameraView> }>;

export interface UniversalCaptureScreenProps {
  guideConfig?: CaptureGuideConfig;
  onCaptured: (result: UniversalCaptureResult) => void;
  onCancel?: () => void;
}

export function UniversalCaptureScreen({ guideConfig = DEFAULT_CAPTURE_GUIDE_CONFIG, onCaptured, onCancel }: UniversalCaptureScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const barcodesRef = useRef<DetectedBarcode[]>([]);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    barcodesRef.current = dedupeBarcodes([...barcodesRef.current, toDetectedBarcode(result)]);
  }, []);

  const capture = useCallback(async () => {
    if (!cameraRef.current || processing) return;
    setError(null);
    setProcessing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, exif: true, skipProcessing: false });
      if (!photo) throw new Error("La capture n'a produit aucune image.");

      const exifOrientation = parseExifOrientation(photo.exif);
      const normalized = await normalizeOrientation({
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        exifOrientation,
      });

      const rect = computeAssumedRegionRect(normalized.width, normalized.height, guideConfig.aspectRatio, guideConfig.widthFraction);
      const region = await generateGuideFrameCrop(normalized.uri, rect);

      const fileInfo = await FileSystem.getInfoAsync(normalized.uri);
      const fileSizeBytes = fileInfo.exists ? fileInfo.size : 0;

      const qualitySignals = {
        originalWidth: normalized.width,
        originalHeight: normalized.height,
        fileSizeBytes,
        exposureTimeSeconds: parseExifExposureTime(photo.exif),
        isoSpeed: parseExifIsoSpeed(photo.exif),
        assumedRegionCropWidth: region.crop.width,
        assumedRegionCropHeight: region.crop.height,
      };

      const warnings = [...evaluateQuality(qualitySignals), ...possibleRotationWarning(normalized.orientation.pixelsPhysicallyRotated)];

      const result: UniversalCaptureResult = {
        captureType: "camera",
        normalizedImage: { uri: normalized.uri, width: normalized.width, height: normalized.height, format: "jpeg" },
        detectedRegions: [region],
        barcodes: barcodesRef.current,
        orientation: normalized.orientation,
        qualitySignals,
        warnings,
      };

      barcodesRef.current = [];
      onCaptured(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue lors de la capture.");
    } finally {
      setProcessing(false);
    }
  }, [processing, guideConfig, onCaptured]);

  if (!permission) {
    // `useCameraPermissions()` résout son état initial très rapidement (lecture locale, jamais
    // un appel réseau) — état borné, jamais une attente indéfinie.
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.instruction}>DealRadar a besoin de l'appareil photo pour capturer un objet.</Text>
        <Button title="Autoriser l'appareil photo" onPress={() => void requestPermission()} />
        {onCancel && <Button title="Annuler" onPress={onCancel} />}
      </View>
    );
  }

  if (mountError) {
    return (
      <View style={styles.center}>
        <Text style={styles.instruction}>Impossible d'utiliser l'appareil photo : {mountError}</Text>
        <Button title="Réessayer" onPress={() => setMountError(null)} />
        {onCancel && <Button title="Retour" onPress={onCancel} />}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraViewTag
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={() => setCameraReady(true)}
        onMountError={(event: CameraMountError) => setMountError(event.message)}
        onBarcodeScanned={handleBarcodeScanned}
        barcodeScannerSettings={{ barcodeTypes: [...SUPPORTED_BARCODE_TYPES] }}
      >
        <View style={styles.overlay} pointerEvents="none">
          <View style={[styles.guideFrame, { aspectRatio: guideConfig.aspectRatio, width: `${guideConfig.widthFraction * 100}%` }]} />
          <Text style={styles.instruction}>{guideConfig.instructionText}</Text>
        </View>
      </CameraViewTag>

      <View style={styles.actions}>
        {onCancel && <Button title="Annuler" onPress={onCancel} disabled={processing} />}
        <Button title={processing ? "Traitement…" : "Capturer"} onPress={() => void capture()} disabled={!cameraReady || processing} />
      </View>

      {processing && (
        <View style={styles.processingOverlay}>
          <ActivityIndicator size="large" />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  camera: { flex: 1 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  guideFrame: { borderWidth: 2, borderColor: "#fff", borderStyle: "dashed", borderRadius: 12 },
  instruction: { color: "#fff", textAlign: "center", fontSize: 13, paddingHorizontal: 24, textShadowColor: "#000", textShadowRadius: 4 },
  actions: { flexDirection: "row", justifyContent: "center", gap: 12, padding: 16 },
  processingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.3)" },
  error: { color: "#fca5a5", textAlign: "center", padding: 8 },
});
