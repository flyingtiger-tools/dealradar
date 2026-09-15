import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "./Icon";
import { borderWidth, colors, spacing, typography } from "../../theme/tokens";

export interface ListRowProps {
  icon?: IconName;
  label: string;
  /** Valeur secondaire alignée à droite (ex. un email, une version) — jamais un chiffre inventé. */
  value?: string;
  onPress?: () => void;
  /** N'affiche le chevron que si la ligne est réellement navigable (`onPress` fourni) — jamais un chevron décoratif sur une ligne informative. */
  chevron?: boolean;
  tone?: "default" | "danger" | "muted";
  /** Dernière ligne d'un groupe — retire le séparateur bas (Phase 25 : hiérarchie de surfaces, pas de card-in-card). */
  last?: boolean;
  accessibilityLabel?: string;
}

/**
 * Ligne de liste "réglages" (icône / libellé / valeur optionnelle / chevron)
 * — remplace les paires Card+AppButton empilées de Profile/Internal Tools
 * (Phase 20/25, LOT "visual product pass") par un groupe compact au style
 * iOS Settings. Plusieurs `ListRow` doivent être englobées dans une seule
 * `Card` par section — jamais une carte par ligne.
 */
export function ListRow({ icon, label, value, onPress, chevron = Boolean(onPress), tone = "default", last = false, accessibilityLabel }: ListRowProps) {
  const labelColor = tone === "danger" ? colors.danger : tone === "muted" ? colors.textSecondary : colors.textPrimary;
  const iconColor = tone === "danger" ? colors.danger : colors.textSecondary;

  const content = (
    <View style={[styles.row, !last && styles.divider]}>
      {icon && <Icon name={icon} size={20} color={iconColor} />}
      <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
      {value && (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      )}
      {chevron && onPress && <Icon name="chevron-forward" size={16} color={colors.textMuted} />}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  divider: { borderBottomWidth: borderWidth.hairline, borderBottomColor: colors.borderSubtle },
  pressed: { opacity: 0.7 },
  label: { ...typography.body, flex: 1 },
  value: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
});
