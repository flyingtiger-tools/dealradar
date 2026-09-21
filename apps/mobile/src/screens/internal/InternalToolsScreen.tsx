import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { Badge } from "../../components/ui/Badge";
import { ListRow } from "../../components/ui/ListRow";
import { clearAllFavorites, clearHistory } from "../../history/storage";
import { resetOnboarding } from "../../onboarding/onboarding-storage";
import { colors, spacing, typography } from "../../theme/tokens";

export interface InternalToolsScreenProps {
  onOpenDatasetTcg: () => void;
  onOpenUiPreview: () => void;
  onOpenBuildInfo: () => void;
  onOpenDiagnostics: () => void;
  onOpenOperatorDiagnostics: () => void;
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
 * "beta product readiness" — regroupement en liste LOT "visual product
 * pass", Phase 20/25 : "réduire les cards inutiles, pas de card > card")
 * — jamais dans la navigation principale, accessible uniquement depuis
 * Profil, et seulement quand `INTERNAL_TOOLS_ENABLED` (déjà vérifié par
 * l'appelant, `ProfileScreen`). Les 7 entrées de navigation vivent
 * maintenant dans UN seul groupe (`ListRow` répétées) plutôt que 7 cartes
 * séparées — les 3 actions de reset restent des boutons `danger` distincts
 * (chacune avec confirmation explicite, Phase 51), volontairement pas
 * fondues dans la même liste pour rester visuellement dangereuses.
 */
export function InternalToolsScreen({
  onOpenDatasetTcg,
  onOpenUiPreview,
  onOpenBuildInfo,
  onOpenDiagnostics,
  onOpenOperatorDiagnostics,
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

      <Card padded={false}>
        <View style={styles.padded}>
          <ListRow icon="cube-outline" label="Dataset TCG" onPress={onOpenDatasetTcg} />
          <ListRow icon="color-palette-outline" label="UI Preview" onPress={onOpenUiPreview} />
          <ListRow icon="information-circle-outline" label="Build info" onPress={onOpenBuildInfo} />
          <ListRow icon="pulse-outline" label="Diagnostics" onPress={onOpenDiagnostics} />
          <ListRow icon="server-outline" label="Diagnostics opérateur" onPress={onOpenOperatorDiagnostics} />
          <ListRow icon="camera-outline" label="Capture universelle (bêta)" onPress={onOpenUniversalCapture} />
          <ListRow icon="chatbubble-outline" label="Copilote (spike)" onPress={onOpenCopilot} />
          <ListRow icon="school-outline" label="Onboarding (aperçu)" onPress={onOpenOnboardingPreview} last />
        </View>
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
  sectionTitle: { ...typography.eyebrow, color: colors.textSecondary, marginTop: spacing.md },
  section: { gap: spacing.xs },
  padded: { paddingHorizontal: spacing.lg },
});
