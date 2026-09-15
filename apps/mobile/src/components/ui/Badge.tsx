import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../../theme/tokens";

export interface BadgeProps {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "primary";
}

/** Petit badge pilule — statut, tag, "OUTIL INTERNE", etc. */
export function Badge({ label, tone = "neutral" }: BadgeProps) {
  const { bg, fg } = TONE_COLORS[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

// Contrastes vérifiés (WCAG 2.1, formule de luminance relative) — chaque
// paire fond/texte atteint au moins 4.5:1 (AA, texte normal) :
// success/background 7.83:1, warning/background 10.95:1, primary/
// textOnPrimary 4.91:1. `danger` utilisait `textOnPrimary` (blanc) sur
// `#FF4D4F`, qui ne fait que 3.12:1 (échoue AA) — corrigé vers
// `colors.background` (5.46:1), même motif texte-sombre-sur-fond-vif que
// success/warning.
const TONE_COLORS: Record<NonNullable<BadgeProps["tone"]>, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceRaised, fg: colors.textSecondary },
  success: { bg: colors.success, fg: colors.background },
  warning: { bg: colors.warning, fg: colors.background },
  danger: { bg: colors.danger, fg: colors.background },
  primary: { bg: colors.primary, fg: colors.textOnPrimary },
};

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  label: { ...typography.captionStrong },
});
