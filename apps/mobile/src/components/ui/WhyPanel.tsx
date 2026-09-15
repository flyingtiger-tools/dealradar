import { StyleSheet, Text } from "react-native";
import { Card } from "./Card";
import { colors, spacing, typography } from "../../theme/tokens";

export interface WhyPanelProps {
  /** Éléments favorables — reflète `AnalysisResult.reasons` (`@dealradar/contracts`) quand disponible ; toujours `[]` pour un résultat TCG aujourd'hui (aucune donnée équivalente produite par ce chemin, voir raf-mapping.ts). */
  positives: string[];
  /** Éléments défavorables — reflète `AnalysisResult.warnings` / `TcgCardAnalysisResult.warnings`, toujours des avertissements réels du pipeline, jamais inventés ici. */
  warnings: string[];
}

/**
 * Panneau "Pourquoi ?" (Phase 11). N'affiche que des éléments réellement
 * fournis par le résultat — si `positives` et `warnings` sont vides, ne se
 * rend pas du tout (jamais un panneau vide ou un texte de remplissage).
 */
export function WhyPanel({ positives, warnings }: WhyPanelProps) {
  if (positives.length === 0 && warnings.length === 0) return null;
  return (
    <Card>
      <Text style={styles.title}>Pourquoi ?</Text>
      {positives.map((item, i) => (
        <Text key={`p-${i}`} style={styles.positive}>
          ✓ {item}
        </Text>
      ))}
      {warnings.map((item, i) => (
        <Text key={`w-${i}`} style={styles.warning}>
          ⚠ {item}
        </Text>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.subtitle, color: colors.textPrimary, marginBottom: spacing.sm },
  positive: { ...typography.body, color: colors.success, marginBottom: spacing.xs },
  warning: { ...typography.body, color: colors.warning, marginBottom: spacing.xs },
});
