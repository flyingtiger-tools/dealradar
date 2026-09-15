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

const TONE_COLORS: Record<NonNullable<BadgeProps["tone"]>, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceRaised, fg: colors.textSecondary },
  success: { bg: colors.success, fg: colors.background },
  warning: { bg: colors.warning, fg: colors.background },
  danger: { bg: colors.danger, fg: colors.textOnPrimary },
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
