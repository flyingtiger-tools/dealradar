import { StyleSheet, Text, View } from "react-native";
import { RafIllustration } from "./RafIllustration";
import type { RafState } from "../../theme/raf-mapping";
import { colors, spacing, typography } from "../../theme/tokens";
import { AppButton, type AppButtonProps } from "../ui/AppButton";

export interface RafEmptyStateProps {
  state?: RafState;
  title: string;
  subtitle?: string;
  action?: { title: string; onPress: () => void; variant?: AppButtonProps["variant"] };
}

/**
 * Empty state partagé (Phase 17) — aucune analyse, aucun favori, offline,
 * erreur, aucune donnée marché. Ton court, utile, jamais infantile (voir
 * docs/mobile/ui-product-foundation.md pour le ton de copy retenu).
 */
export function RafEmptyState({ state = "neutral", title, subtitle, action }: RafEmptyStateProps) {
  return (
    <View style={styles.container}>
      <RafIllustration state={state} size={120} />
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {action && (
        <AppButton title={action.title} onPress={action.onPress} variant={action.variant ?? "secondary"} style={styles.action} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: "center" },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  action: { marginTop: spacing.sm },
});
