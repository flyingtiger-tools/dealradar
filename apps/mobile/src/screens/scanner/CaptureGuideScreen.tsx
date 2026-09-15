import { StyleSheet, Text, View } from "react-native";
import { RafMessage } from "../../components/raf/RafMessage";
import { ErrorState } from "../../components/errors/ErrorState";
import { AppButton } from "../../components/ui/AppButton";
import { borderWidth, colors, radius, spacing, typography } from "../../theme/tokens";

export interface CaptureGuideScreenProps {
  /** Message d'erreur brut de la dernière tentative — `null` en état normal (idle). */
  errorMessage?: string | null;
  onTakePhoto: () => void;
  onPickFromGallery: () => void;
  onManualEntry: () => void;
}

/**
 * Écran d'accueil du scanner (Phase 5) — cadre visuel (proportions carte
 * TCG standard, 63×88mm), conseil anti-reflet, bouton de capture clair,
 * repli saisie manuelle. Ne déclenche jamais la caméra/galerie elle-même
 * (permissions gérées par l'appelant, `TcgScanScreen.tsx`, inchangé) —
 * purement présentationnel.
 */
export function CaptureGuideScreen({ errorMessage, onTakePhoto, onPickFromGallery, onManualEntry }: CaptureGuideScreenProps) {
  return (
    <View style={styles.container}>
      {errorMessage && <ErrorState source={{ kind: "message", raw: errorMessage }} />}

      <View style={styles.frame} />
      <RafMessage state="scanning" message="Carte bien droite, sans reflet, numéro du bas lisible." />

      <View style={styles.actions}>
        <AppButton title="Prendre une photo" onPress={onTakePhoto} />
        <AppButton title="Choisir depuis la galerie" onPress={onPickFromGallery} variant="secondary" />
      </View>

      <Text style={styles.manualLinkWrapper} onPress={onManualEntry}>
        Je connais déjà les infos de la carte
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  // Proportions carte TCG standard (63mm x 88mm ≈ 0.716) — repère visuel uniquement, aucun cadrage forcé (identique à l'ancien `TcgScanScreen`).
  frame: { width: 190, height: 265, borderWidth: borderWidth.medium, borderColor: colors.primary, borderStyle: "dashed", borderRadius: radius.lg },
  actions: { width: "100%", gap: spacing.sm },
  manualLinkWrapper: { ...typography.body, color: colors.primary, textAlign: "center", marginTop: spacing.sm },
});
