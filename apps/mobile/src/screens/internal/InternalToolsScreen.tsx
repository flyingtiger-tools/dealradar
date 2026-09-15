import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { Badge } from "../../components/ui/Badge";
import { colors, spacing, typography } from "../../theme/tokens";

export interface InternalToolsScreenProps {
  onOpenDatasetTcg: () => void;
  onOpenUiPreview: () => void;
  onOpenBuildInfo: () => void;
  onOpenUniversalCapture: () => void;
  onOpenCopilot: () => void;
  onOpenOnboardingPreview: () => void;
  onBack: () => void;
}

/**
 * Outils internes (Phases 3/14/15) — jamais dans la navigation principale,
 * accessible uniquement depuis Profil, et seulement quand
 * `INTERNAL_TOOLS_ENABLED` (déjà vérifié par l'appelant, `ProfileScreen`).
 * Regroupe tout ce qui n'est pas destiné à un build grand public : Dataset
 * TCG (inchangé, Phase 28), UI Preview (Phase 15), Build info (Phase 14),
 * Capture universelle bêta et Copilote (features réelles existantes,
 * démotées ici hors de la barre d'onglets consommateur — voir
 * docs/mobile/ui-product-foundation.md, décision de placement).
 */
export function InternalToolsScreen({
  onOpenDatasetTcg,
  onOpenUiPreview,
  onOpenBuildInfo,
  onOpenUniversalCapture,
  onOpenCopilot,
  onOpenOnboardingPreview,
  onBack,
}: InternalToolsScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Outils internes</Text>
        <Badge label="INTERNE" tone="warning" />
      </View>

      <Card style={styles.section}>
        <AppButton title="Dataset TCG" onPress={onOpenDatasetTcg} variant="secondary" />
      </Card>
      <Card style={styles.section}>
        <AppButton title="UI Preview" onPress={onOpenUiPreview} variant="secondary" />
      </Card>
      <Card style={styles.section}>
        <AppButton title="Build info" onPress={onOpenBuildInfo} variant="secondary" />
      </Card>
      <Card style={styles.section}>
        <AppButton title="Capture universelle (bêta)" onPress={onOpenUniversalCapture} variant="secondary" />
      </Card>
      <Card style={styles.section}>
        <AppButton title="Copilote (spike)" onPress={onOpenCopilot} variant="secondary" />
      </Card>
      <Card style={styles.section}>
        <AppButton title="Onboarding (aperçu)" onPress={onOpenOnboardingPreview} variant="secondary" />
      </Card>

      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  section: { gap: spacing.xs },
});
