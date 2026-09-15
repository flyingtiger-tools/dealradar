import { StyleSheet, Text, View } from "react-native";
import { Badge, type BadgeProps } from "./Badge";
import { colors, spacing, typography } from "../../theme/tokens";

export interface ScoreConfidenceRowProps {
  /** Score DealRadar 0-100 (`dealScore`, `@dealradar/contracts`) — `null` si non calculé pour cette catégorie (ex. scan carte TCG aujourd'hui, voir raf-mapping.ts). */
  score: number | null;
  /** Confiance 0-100, déjà convertie par l'appelant (TCG : `Math.round(confidence * 100)` ; générique : `confidenceScore` tel quel). */
  confidencePercent: number | null;
}

/** Regroupement purement présentationnel (jamais un seuil métier) — sert uniquement à choisir le ton du badge, pas à décider quoi que ce soit. */
function confidenceBucket(percent: number): { label: string; tone: BadgeProps["tone"] } {
  if (percent >= 80) return { label: "élevée", tone: "success" };
  if (percent >= 50) return { label: "moyenne", tone: "warning" };
  return { label: "faible", tone: "danger" };
}

/**
 * Affiche Score et Confiance côte à côte, avec des TRAITEMENTS VISUELS
 * DISTINCTS (Phase 12/15 : "jamais la même présentation") — le score est
 * un grand chiffre (c'est LA métrique qu'on scanne en un coup d'œil), la
 * confiance est un badge qualitatif (c'est une nuance sur la fiabilité de
 * la donnée, pas une seconde métrique du même ordre). Chaque bloc ne
 * s'affiche que si sa donnée existe réellement — aucune valeur par défaut
 * inventée.
 */
export function ScoreConfidenceRow({ score, confidencePercent }: ScoreConfidenceRowProps) {
  if (score === null && confidencePercent === null) return null;
  return (
    <View style={styles.row}>
      {score !== null && (
        <View style={styles.scoreBlock}>
          <Text style={styles.scoreLabel}>Score DealRadar</Text>
          <View style={styles.scoreValueRow}>
            <Text style={styles.scoreValue}>{Math.round(score)}</Text>
            <Text style={styles.scoreMax}>/100</Text>
          </View>
        </View>
      )}
      {confidencePercent !== null && (
        <View style={styles.confidenceBlock}>
          <Text style={styles.scoreLabel}>Confiance</Text>
          <Badge label={`${confidenceBucket(confidencePercent).label} (${Math.round(confidencePercent)}%)`} tone={confidenceBucket(confidencePercent).tone} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.xl, alignItems: "flex-start" },
  scoreBlock: { gap: spacing.xs },
  scoreLabel: { ...typography.caption, color: colors.textSecondary },
  scoreValueRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  scoreValue: { ...typography.metric, color: colors.textPrimary },
  scoreMax: { ...typography.body, color: colors.textMuted },
  confidenceBlock: { gap: spacing.xs, justifyContent: "flex-start" },
});
