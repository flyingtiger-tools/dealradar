import { StyleSheet, Text, View } from "react-native";
import type { ProductHistorySnapshotPointViewModel } from "../../history/product-history-detail-view-model";
import { formatMoney } from "../../format/money";
import { formatAnalysisDate } from "../../format/date";
import { colors, spacing, typography } from "../../theme/tokens";

export interface ProductHistoryChartProps {
  points: ProductHistorySnapshotPointViewModel[];
}

const CHART_HEIGHT = 120;
const MIN_BAR_HEIGHT = 4;

/**
 * Graphique en barres MINIMAL (LOT "Product History UX + Source Health +
 * Interactive Cancellation + Beta Readiness", section 1) — AUCUNE
 * bibliothèque SVG/graphique ajoutée (aucune n'était déjà présente dans ce
 * projet RN/Expo, voir `apps/mobile/package.json`) : `View`+`StyleSheet`
 * suffisent, conformément à l'instruction explicite du lot ("prefer a
 * minimal SVG/path implementation already supported by dependencies
 * rather than adding a heavy library" — ici, même l'SVG est évité puisque
 * `react-native-svg` n'est pas installé).
 *
 * Chaque point REND une barre DISCRÈTE, jamais une ligne/courbe
 * interpolée entre deux points — évite toute interpolation trompeuse
 * au-delà des observations réelles (règle explicite du lot). Espacement
 * UNIFORME entre barres (jamais un vrai axe temporel proportionnel) —
 * délibéré : un espacement proportionnel au temps réel laisserait croire à
 * une continuité que des données clairsemées n'ont pas.
 *
 * Accessible : chaque barre porte un `accessibilityLabel` texte complet
 * (date + prix), jamais une information uniquement visuelle/colorée.
 */
export function ProductHistoryChart({ points }: ProductHistoryChartProps) {
  if (points.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Aucun point d'historique disponible.</Text>
      </View>
    );
  }

  // `points` arrive du plus récent au plus ancien (voir `toProductHistoryDetailViewModel`) — inversé pour un affichage chronologique gauche->droite, plus naturel à lire.
  const chronological = [...points].reverse();
  const values = chronological.map((p) => p.fairCents).filter((v): v is number => v !== null);
  const maxValue = values.length > 0 ? Math.max(...values) : null;
  const minValue = values.length > 0 ? Math.min(...values) : null;
  const range = maxValue !== null && minValue !== null ? maxValue - minValue : 0;

  return (
    <View>
      <View style={styles.chart}>
        {chronological.map((point, i) => {
          const barHeight =
            point.fairCents === null || maxValue === null || range === 0
              ? CHART_HEIGHT * 0.5 // valeur unique/inconnue : barre médiane neutre, jamais une hauteur 0 qui laisserait croire à un prix nul.
              : Math.max(MIN_BAR_HEIGHT, ((point.fairCents - minValue!) / range) * CHART_HEIGHT);
          const label = point.fairCents === null ? "Prix inconnu" : formatMoney(point.fairCents / 100, point.currency);
          return (
            <View key={`${point.cycleAt}-${i}`} style={styles.barColumn}>
              <View
                style={[styles.bar, { height: barHeight }, point.fairCents === null && styles.barUnknown]}
                accessible
                accessibilityLabel={`${formatAnalysisDate(point.cycleAt)} : ${label}`}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.axisLabels}>
        <Text style={styles.axisLabel}>{formatAnalysisDate(chronological[0]!.cycleAt)}</Text>
        {chronological.length > 1 && <Text style={styles.axisLabel}>{formatAnalysisDate(chronological[chronological.length - 1]!.cycleAt)}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: "row", alignItems: "flex-end", height: CHART_HEIGHT, gap: 3 },
  barColumn: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: CHART_HEIGHT },
  bar: { width: "100%", maxWidth: 18, backgroundColor: colors.primary, borderRadius: 2 },
  barUnknown: { opacity: 0.3 },
  axisLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  axisLabel: { ...typography.caption, color: colors.textMuted },
  empty: { height: CHART_HEIGHT, alignItems: "center", justifyContent: "center" },
  emptyText: { ...typography.body, color: colors.textMuted },
});
