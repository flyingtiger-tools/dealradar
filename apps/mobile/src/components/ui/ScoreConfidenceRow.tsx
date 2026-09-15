import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../../theme/tokens";

export interface ScoreConfidenceRowProps {
  /** Score DealRadar 0-100 (`dealScore`, `@dealradar/contracts`) — `null` si non calculé pour cette catégorie (ex. scan carte TCG aujourd'hui, voir raf-mapping.ts). */
  score: number | null;
  /** Confiance 0-100, déjà convertie par l'appelant (TCG : `Math.round(confidence * 100)` ; générique : `confidenceScore` tel quel). */
  confidencePercent: number | null;
}

function confidenceLabel(percent: number): string {
  if (percent >= 80) return "élevée";
  if (percent >= 50) return "moyenne";
  return "faible";
}

/**
 * Affiche Score et Confiance côte à côte, jamais mélangés dans une seule
 * valeur (Phase 9). Chaque bloc ne s'affiche que si sa donnée existe
 * réellement — aucune valeur par défaut inventée.
 */
export function ScoreConfidenceRow({ score, confidencePercent }: ScoreConfidenceRowProps) {
  if (score === null && confidencePercent === null) return null;
  return (
    <View style={styles.row}>
      {score !== null && (
        <View style={styles.block}>
          <Text style={styles.label}>Score</Text>
          <Text style={styles.value}>{Math.round(score)}/100</Text>
        </View>
      )}
      {confidencePercent !== null && (
        <View style={styles.block}>
          <Text style={styles.label}>Confiance</Text>
          <Text style={styles.value}>
            {confidenceLabel(confidencePercent)} ({Math.round(confidencePercent)}%)
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.xl },
  block: { gap: 2 },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.subtitle, color: colors.textPrimary },
});
