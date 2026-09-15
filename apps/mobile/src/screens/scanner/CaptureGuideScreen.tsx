import { Pressable, StyleSheet, Text, View } from "react-native";
import { ErrorState } from "../../components/errors/ErrorState";
import { ScanFrame } from "../../components/scanner/ScanFrame";
import { ShutterButton } from "../../components/scanner/ShutterButton";
import { Icon } from "../../components/ui/Icon";
import { colors, spacing, typography } from "../../theme/tokens";

export interface CaptureGuideScreenProps {
  /** Message d'erreur brut de la dernière tentative — `null` en état normal (idle). */
  errorMessage?: string | null;
  onTakePhoto: () => void;
  onPickFromGallery: () => void;
  onManualEntry: () => void;
}

/**
 * Écran d'accueil du scanner (Phase 7, LOT "visual product pass" —
 * priorité haute : "il doit avoir l'air fini") — cadre à coins précis
 * (`ScanFrame`, viseur plutôt qu'un simple rectangle en pointillés),
 * bouton shutter propre (`ShutterButton`), action galerie secondaire
 * claire avec icône, repli saisie manuelle discret. Ne déclenche jamais la
 * caméra/galerie elle-même (permissions gérées par l'appelant,
 * `TcgScanScreen.tsx`, inchangé) — purement présentationnel.
 */
export function CaptureGuideScreen({ errorMessage, onTakePhoto, onPickFromGallery, onManualEntry }: CaptureGuideScreenProps) {
  return (
    <View style={styles.container}>
      {errorMessage && <ErrorState source={{ kind: "message", raw: errorMessage }} />}

      <View style={styles.frameArea}>
        <ScanFrame />
      </View>
      <Text style={styles.instruction}>Carte bien droite, sans reflet, numéro du bas lisible.</Text>

      <View style={styles.actions}>
        <ShutterButton onPress={onTakePhoto} />
        <Pressable onPress={onPickFromGallery} accessibilityRole="button" accessibilityLabel="Choisir depuis la galerie" style={styles.galleryButton}>
          <Icon name="images-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.galleryLabel}>Galerie</Text>
        </Pressable>
      </View>

      <Text style={styles.manualLink} onPress={onManualEntry}>
        Je connais déjà les infos de la carte
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl, padding: spacing.xl },
  frameArea: { alignItems: "center", justifyContent: "center" },
  instruction: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  actions: { alignItems: "center", gap: spacing.md },
  galleryButton: { flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: spacing.sm },
  galleryLabel: { ...typography.body, color: colors.textSecondary },
  manualLink: { ...typography.body, color: colors.primary, textAlign: "center" },
});
