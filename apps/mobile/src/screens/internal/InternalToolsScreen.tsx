import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { Badge } from "../../components/ui/Badge";
import { clearAllFavorites, clearHistory } from "../../history/storage";
import { resetOnboarding } from "../../onboarding/onboarding-storage";
import { colors, spacing, typography } from "../../theme/tokens";

export interface InternalToolsScreenProps {
  onOpenDatasetTcg: () => void;
  onOpenUiPreview: () => void;
  onOpenBuildInfo: () => void;
  onOpenDiagnostics: () => void;
  onOpenUniversalCapture: () => void;
  onOpenCopilot: () => void;
  onOpenOnboardingPreview: () => void;
  onBack: () => void;
}

function confirmDestructive(title: string, message: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Annuler", style: "cancel" },
    { text: "Confirmer", style: "destructive", onPress: onConfirm },
  ]);
}

/**
 * Outils internes (Phases 3/14/15 du lot précédent, Phase 31/33/51 du LOT
 * "beta product readiness") — jamais dans la navigation principale,
 * accessible uniquement depuis Profil, et seulement quand
 * `INTERNAL_TOOLS_ENABLED` (déjà vérifié par l'appelant, `ProfileScreen`).
 * Regroupe tout ce qui n'est pas destiné à un build grand public : Dataset
 * TCG (inchangé), UI Preview, Build info, Diagnostics (Phase 33), Capture
 * universelle bêta et Copilote (démotées hors de la barre d'onglets
 * consommateur), et les 3 actions de reset — chacune avec confirmation
 * explicite (Phase 51 : "chaque action destructive : confirmation").
 */
export function InternalToolsScreen({
  onOpenDatasetTcg,
  onOpenUiPreview,
  onOpenBuildInfo,
  onOpenDiagnostics,
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
        <AppButton title="Diagnostics" onPress={onOpenDiagnostics} variant="secondary" />
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

      <Text style={styles.sectionTitle}>Réinitialisation (QA)</Text>
      <Card style={styles.section}>
        <AppButton
          title="Reset onboarding"
          variant="danger"
          onPress={() =>
            confirmDestructive("Réinitialiser l'onboarding ?", "Ferme et rouvre l'app pour le revoir au prochain lancement.", () => void resetOnboarding())
          }
        />
      </Card>
      <Card style={styles.section}>
        <AppButton
          title="Clear local history"
          variant="danger"
          onPress={() => confirmDestructive("Effacer l'historique local ?", "Cette action est irréversible.", () => void clearHistory())}
        />
      </Card>
      <Card style={styles.section}>
        <AppButton
          title="Clear favorites"
          variant="danger"
          onPress={() => confirmDestructive("Effacer les favoris ?", "Retire le drapeau favori de toutes les entrées — l'historique lui-même n'est pas supprimé.", () => void clearAllFavorites())}
        />
      </Card>

      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, marginTop: spacing.md },
  section: { gap: spacing.xs },
});
