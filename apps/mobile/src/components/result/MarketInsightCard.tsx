import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ResultMarketInsight } from "../../screens/result/result-view-model";
import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { colors, spacing, typography } from "../../theme/tokens";

export interface MarketInsightCardProps {
  insight: ResultMarketInsight;
  /**
   * Action "Voir l'historique" (LOT "Product History UX + Source Health +
   * Interactive Cancellation + Beta Readiness", section 2) — `undefined` =
   * bouton absent (jamais affiché sans une navigation réelle fournie par
   * l'appelant, qui décide lui-même si `productKey` est disponible — voir
   * `ResultScreen.tsx`/`UniversalScanScreen.tsx`). Jamais affiché pour un
   * résultat TCG : `mapTcgResultToViewModel` ne fournit jamais `insight`
   * (`MarketInsightCard` n'est de toute façon jamais rendu, voir
   * `ResultScreen.tsx`).
   */
  onViewHistory?: () => void;
}

/**
 * Résumé condensé de la preuve de marché pour un résultat GÉNÉRIQUE
 * (non-TCG) — LOT "Interactive History + Generic Result UI + Full
 * Cancellation + Pre-Prod Activation Package", section 3. N'affiche QUE
 * `insight` (déjà traduit/borné par `from-analysis-result-view-model.ts`,
 * `buildMarketInsight`) — aucun code technique brut ("Tier", "percentile",
 * nom de connecteur cru), aucune fourchette de prix dupliquée (déjà
 * affichée par `PriceHero`/`ScoreConfidenceRow` dans `ResultScreen`). Au
 * plus `MAX_QUALITY_REASONS` raisons affichées — jamais un déversement
 * technique complet.
 */
const MAX_QUALITY_REASONS = 3;

export function MarketInsightCard({ insight, onViewHistory }: MarketInsightCardProps) {
  const warningText = insight.retailOnlyWarning
    ? "Basé uniquement sur des prix neufs en boutique, jamais une vente d'occasion confirmée."
    : insight.activeListingOnlyWarning
      ? "Basé uniquement sur des annonces en cours, aucune vente confirmée."
      : null;

  const visibleReasons = insight.qualityReasons.slice(0, MAX_QUALITY_REASONS);

  const hasAnyLine = insight.sourceCount !== null || insight.trendLabel !== null || insight.currentVsHistoryLabel !== null || warningText !== null || visibleReasons.length > 0 || Boolean(onViewHistory);
  if (!hasAnyLine) return null;

  return (
    <Card style={styles.container}>
      <Text style={styles.title}>Preuve de marché</Text>
      {insight.sourceCount !== null && (
        <Text style={styles.line}>
          Basé sur {insight.sourceCount} source{insight.sourceCount > 1 ? "s" : ""}
          {insight.strongestEvidenceLabel ? ` · ${insight.strongestEvidenceLabel}` : ""}
        </Text>
      )}
      {insight.trendLabel !== null && <Text style={styles.line}>{insight.trendLabel}</Text>}
      {insight.currentVsHistoryLabel !== null && <Text style={styles.line}>{insight.currentVsHistoryLabel}</Text>}
      {warningText !== null && (
        <View style={styles.warningRow}>
          <Icon name="alert-circle" size={16} color={colors.warning} />
          <Text style={styles.warningText}>{warningText}</Text>
        </View>
      )}
      {visibleReasons.map((reason, i) => (
        <Text key={i} style={styles.reason}>
          · {reason}
        </Text>
      ))}
      {onViewHistory && (
        <Pressable onPress={onViewHistory} accessibilityRole="button" accessibilityLabel="Voir l'historique" style={({ pressed }) => [styles.historyRow, pressed && styles.historyRowPressed]}>
          <Text style={styles.historyLabel}>Voir l'historique</Text>
          <Icon name="chevron-forward" size={16} color={colors.primary} />
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  title: { ...typography.sectionTitle, color: colors.textPrimary, marginBottom: spacing.xs },
  line: { ...typography.body, color: colors.textSecondary },
  warningRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.xs },
  warningText: { ...typography.body, color: colors.warning, flex: 1 },
  reason: { ...typography.caption, color: colors.textMuted },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm, paddingVertical: spacing.xs },
  historyRowPressed: { opacity: 0.6 },
  historyLabel: { ...typography.bodyStrong, color: colors.primary },
});
