import { StyleSheet, View } from "react-native";
import { colors, radius } from "../../theme/tokens";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

export interface StatusDotProps {
  tone: StatusTone;
}

const TONE_COLOR: Record<StatusTone, string> = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  neutral: colors.textMuted,
};

/** Petit point coloré (Diagnostics, Phase 21 : "green/yellow/red dot" plutôt qu'un simple texte OUI/NON) — jamais la SEULE information (toujours accompagné d'un libellé texte, WCAG "pas d'info uniquement par couleur"). */
export function StatusDot({ tone }: StatusDotProps) {
  return <View style={[styles.dot, { backgroundColor: TONE_COLOR[tone] }]} />;
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
