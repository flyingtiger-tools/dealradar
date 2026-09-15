import { StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { colors, spacing, typography } from "../../theme/tokens";

export interface WhyPanelProps {
  /** Éléments favorables — reflète `AnalysisResult.reasons` (`@dealradar/contracts`) quand disponible ; toujours `[]` pour un résultat TCG aujourd'hui (aucune donnée équivalente produite par ce chemin, voir raf-mapping.ts). */
  positives: string[];
  /** Éléments défavorables — reflète `AnalysisResult.warnings` / `TcgCardAnalysisResult.warnings`, toujours des avertissements réels du pipeline, jamais inventés ici. */
  warnings: string[];
}

/**
 * Panneau "Pourquoi ?" (Phase 14, LOT "visual product pass" : "très
 * lisible, pas de JSON, pas de jargon"). Icônes réelles (`Icon.tsx`)
 * plutôt que les glyphes ✓/⚠ bruts — même famille que le reste de l'app.
 * N'affiche que des éléments réellement fournis par le résultat — si
 * `positives` et `warnings` sont vides, ne se rend pas du tout (jamais un
 * panneau vide ou un texte de remplissage).
 */
export function WhyPanel({ positives, warnings }: WhyPanelProps) {
  if (positives.length === 0 && warnings.length === 0) return null;
  return (
    <Card>
      <Text style={styles.title}>Pourquoi ?</Text>
      {positives.map((item, i) => (
        <View key={`p-${i}`} style={styles.row}>
          <Icon name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.positive}>{item}</Text>
        </View>
      ))}
      {warnings.map((item, i) => (
        <View key={`w-${i}`} style={styles.row}>
          <Icon name="alert-circle" size={16} color={colors.warning} />
          <Text style={styles.warning}>{item}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.subtitle, color: colors.textPrimary, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.xs },
  positive: { ...typography.body, color: colors.success, flex: 1 },
  warning: { ...typography.body, color: colors.warning, flex: 1 },
});
