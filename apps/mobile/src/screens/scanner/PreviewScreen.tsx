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
 * Aperçu photo (Phase 6) — photo, avertissements réels s'il y en a,
 * "Reprendre" / "Analyser". Le message Raf ne s'affiche QUE quand un
 * avertissement réel existe (Phase 6 : "pas de fake insight").
 */
export function PreviewScreen({ imageUri, warnings = [], onRetake, onAnalyze }: PreviewScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Aperçu</Text>
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
        <AppButton title="Reprendre la photo" onPress={onRetake} variant="secondary" />
        <AppButton title="Analyser" onPress={onAnalyze} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.title, color: colors.textPrimary },
  preview: { width: "100%", height: 320, backgroundColor: colors.surface, borderRadius: radius.lg },
  warningBlock: { gap: spacing.xs },
  extraWarning: { ...typography.caption, color: colors.warning, marginLeft: spacing.xxl },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
