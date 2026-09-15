import { useRef } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./Icon";
import { borderWidth, colors, opacity, radius, spacing, typography } from "../../theme/tokens";

export interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  /** Remplace le libellé par un indicateur de chargement, désactive le bouton (Phase 24 : "même height/radius/font/feedback/disabled/loading" pour tous les boutons — jamais un état de chargement improvisé écran par écran). */
  loading?: boolean;
  /** Icône de tête, jamais seule (toujours accompagnée d'un libellé) — voir `Icon.tsx` pour la famille unique. */
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/**
 * Bouton unique de l'app — remplace les `<Button>` RN natifs (non stylables,
 * incohérents entre iOS/Android) utilisés partout dans les écrans "spike"
 * historiques. Retour au press (Phase 27 motion) : `scale(0.97)`, 120ms,
 * natif via `Animated` — aucune librairie ajoutée.
 */
export function AppButton({ title, onPress, variant = "primary", disabled = false, loading = false, icon, style, accessibilityHint }: AppButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;

  const pressIn = () => Animated.timing(scale, { toValue: 0.97, duration: 100, useNativeDriver: true }).start();
  const pressOut = () => Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();

  const textColor = variant === "ghost" ? colors.primary : colors.textOnPrimary;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [
          styles.base,
          VARIANT_STYLES[variant],
          isDisabled && styles.disabled,
          pressed && !isDisabled && styles.pressed,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          <View style={styles.content}>
            {icon && <Icon name={icon} size={18} color={textColor} />}
            <Text style={[styles.label, { color: textColor }]}>{title}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const VARIANT_STYLES: Record<NonNullable<AppButtonProps["variant"]>, StyleProp<ViewStyle>> = {
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surfaceRaised, borderWidth: borderWidth.thin, borderColor: colors.border },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: colors.danger },
};

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: opacity.pressed },
  disabled: { opacity: opacity.disabled },
  content: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { ...typography.bodyStrong },
});
