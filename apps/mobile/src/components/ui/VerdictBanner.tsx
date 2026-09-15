import { StyleSheet, Text, View } from "react-native";
import type { BusinessDecision } from "../../theme/raf-mapping";
import { getVerdictLabel } from "../../theme/raf-mapping";
import { colors, radius, spacing, typography } from "../../theme/tokens";

// Texte toujours `colors.background` (sombre) — exporté pour que
// `__tests__/badge-contrast.test.ts` vérifie mécaniquement le contraste
// contre chacune des 4 couleurs de fond ci-dessous.
export const DECISION_COLOR: Record<BusinessDecision, string> = {
  BUY: colors.verdictBuy,
  REVIEW: colors.verdictReview,
  PASS: colors.verdictPass,
  INSUFFICIENT_DATA: colors.verdictUnknown,
};

export interface VerdictBannerProps {
  decision: BusinessDecision;
}

/**
 * Bandeau verdict très lisible (Phase 8) — ACHETER / ATTENDRE / PASSER /
 * DONNÉES INSUFFISANTES, dérivé de `decision` (`@dealradar/contracts`
 * `analysisDecisionSchema`) sans jamais renommer ni recalculer l'enum
 * métier (voir `theme/raf-mapping.ts`).
 */
export function VerdictBanner({ decision }: VerdictBannerProps) {
  return (
    <View style={[styles.banner, { backgroundColor: DECISION_COLOR[decision] }]}>
      <Text style={styles.label}>{getVerdictLabel(decision)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  label: { ...typography.title, color: colors.background, letterSpacing: 1 },
});
