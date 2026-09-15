import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { RafMessage } from "../../components/raf/RafMessage";
import { AppButton } from "../../components/ui/AppButton";
import { colors, radius, spacing, typography } from "../../theme/tokens";

export interface PreviewScreenProps {
  imageUri: string;
  /** Avertissements RÉELS (ex. `QualityWarningCode` déjà traduits) — `[]` si le flux appelant n'en détecte pas (ex. `TcgScanScreen`, qui ne fait pas d'analyse de qualité aujourd'hui). Jamais un warning fabriqué. */
  warnings?: string[];
  onRetake: () => void;
  onAnalyze: () => void;
}

/**
 * Aperçu photo (Phase 8, LOT "visual product pass" : "checkpoint avant
 * analyse") — la photo reste l'élément dominant de l'écran, pas de
 * card-in-card. Hiérarchie très claire : "Analyser" est l'action
 * principale (bouton primaire pleine largeur), "Reprendre" une action
 * secondaire discrète juste au-dessus, jamais deux boutons de même poids
 * visuel. Le message Raf ne s'affiche QUE quand un avertissement réel
 * existe (Phase 6 précédent : "pas de fake insight").
 */
export function PreviewScreen({ imageUri, warnings = [], onRetake, onAnalyze }: PreviewScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Aperçu</Text>
      <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />

      {warnings.length > 0 && (
        <View style={styles.warningBlock}>
          {/* `warnings.length > 0` garantit `warnings[0]` défini — assertion sûre. */}
          <RafMessage state="warning" message={warnings[0]!} />
          {warnings.slice(1).map((w, i) => (
            <Text key={i} style={styles.extraWarning}>
              ⚠ {w}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <AppButton title="Analyser" onPress={onAnalyze} icon="checkmark-circle" />
        <Text style={styles.retakeLink} onPress={onRetake}>
          Reprendre la photo
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: spacing.lg, gap: spacing.md, justifyContent: "center" },
  eyebrow: { ...typography.eyebrow, color: colors.textSecondary, textAlign: "center" },
  preview: { width: "100%", height: 380, backgroundColor: colors.surface, borderRadius: radius.lg },
  warningBlock: { gap: spacing.xs },
  extraWarning: { ...typography.caption, color: colors.warning, marginLeft: spacing.xxl },
  actions: { gap: spacing.md, marginTop: spacing.sm },
  retakeLink: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
});
