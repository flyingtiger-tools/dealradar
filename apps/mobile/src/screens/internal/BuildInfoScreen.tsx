import Constants from "expo-constants";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { INTERNAL_TOOLS_ENABLED } from "../../config/internal-tools";
import { colors, spacing, typography } from "../../theme/tokens";

export interface BuildInfoScreenProps {
  onBack: () => void;
}

/**
 * Build info (Phase 14/33) — infos réelles issues d'`expo-constants`/
 * `internal-tools.ts`, jamais une valeur inventée. Utile pour confirmer
 * sur le Samsung qu'un build donné est bien le build interne attendu
 * (`applicationId`/nom distincts — voir docs/mobile/internal-build.md).
 */
export function BuildInfoScreen({ onBack }: BuildInfoScreenProps) {
  const appConfig = Constants.expoConfig;
  const rows: [string, string][] = [
    ["Nom", appConfig?.name ?? "—"],
    ["Version", appConfig?.version ?? "—"],
    ["Package Android", appConfig?.android?.package ?? "—"],
    ["Bundle iOS", appConfig?.ios?.bundleIdentifier ?? "—"],
    ["Outils internes actifs", INTERNAL_TOOLS_ENABLED ? "oui" : "non"],
    ["Runtime", Constants.appOwnership ?? "standalone"],
    // Phase 52 (LOT "beta product readiness") : aucune injection de commit/
    // SHA au build n'existe dans ce repo aujourd'hui (aucune variable
    // EXPO_PUBLIC_GIT_SHA ni équivalent) — jamais une valeur inventée ou
    // figée en dur ici ; honnêtement "non disponible" tant que ce
    // mécanisme n'est pas mis en place côté build.
    ["Commit source", "non disponible (aucune injection au build)"],
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Build info</Text>
      <Card style={styles.section}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </Card>
      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary },
  section: { gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  // `flexShrink: 1` sur les deux (LOT "device QA + first real scan",
  // même correctif que DiagnosticsScreen — une valeur longue comme
  // "non disponible (aucune injection au build)" pouvait sinon comprimer
  // `label` au point de couper le texte lettre par lettre, aucun des
  // deux n'ayant de flexShrink déclaré ici avant ce correctif).
  label: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
  value: { ...typography.bodyStrong, color: colors.textPrimary, flexShrink: 1, textAlign: "right" },
});
