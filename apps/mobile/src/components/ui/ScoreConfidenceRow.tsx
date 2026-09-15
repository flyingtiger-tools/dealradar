import { StyleSheet, Text, View } from "react-native";
import { Badge, type BadgeProps } from "./Badge";
import { colors, radius, spacing, typography } from "../../theme/tokens";

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

const SCORE_SEGMENTS = 6;

/** Même principe que `confidenceBucket` : uniquement pour choisir une couleur de segment, jamais un seuil métier (celui-ci reste `dealScore`, `@dealradar/contracts`). Exporté pour `__tests__/score-meter.test.ts`. */
export function scoreSegmentTone(score: number): string {
  if (score >= 80) return colors.success;
  if (score >= 50) return colors.warning;
  return colors.danger;
}

/** Nombre de segments pleins (0-6) pour un score 0-100 — arrondi le plus proche, jamais tronqué (un score de 100 doit remplir les 6 segments). Exporté pour test. */
export function filledSegments(score: number, total: number = SCORE_SEGMENTS): number {
  const clamped = Math.max(0, Math.min(100, score));
  return Math.min(total, Math.round((clamped / 100) * total));
}

/**
 * Affiche Score et Confiance côte à côte, avec des TRAITEMENTS VISUELS
 * DISTINCTS (Phase 12/15 : "jamais la même présentation", renforcé Phase
 * 12 du LOT "visual product pass" : "ne doivent jamais ressembler au même
 * indicateur") — le score est un grand chiffre + un mini "segmented meter"
 * coloré (c'est LA métrique qu'on scanne en un coup d'œil, avec une
 * personnalité visuelle propre), la confiance reste un badge qualitatif
 * (une nuance sur la fiabilité de la donnée, pas une seconde métrique du
 * même ordre). Chaque bloc ne s'affiche que si sa donnée existe réellement
 * — aucune valeur par défaut inventée.
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
          <View style={styles.meter}>
            {Array.from({ length: SCORE_SEGMENTS }, (_, i) => (
              <View
                key={i}
                style={[styles.segment, { backgroundColor: i < filledSegments(score) ? scoreSegmentTone(score) : colors.borderSubtle }]}
              />
            ))}
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
  scoreBlock: { gap: spacing.xs, flex: 1 },
  scoreLabel: { ...typography.caption, color: colors.textSecondary },
  scoreValueRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  scoreValue: { ...typography.metric, color: colors.textPrimary },
  scoreMax: { ...typography.body, color: colors.textMuted },
  meter: { flexDirection: "row", gap: 3, marginTop: 2 },
  segment: { flex: 1, height: 5, borderRadius: radius.sm },
  confidenceBlock: { gap: spacing.xs, justifyContent: "flex-start" },
});
