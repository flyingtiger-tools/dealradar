import { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { borderWidth, colors, opacity, radius, spacing, typography } from "../../theme/tokens";

export interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/**
 * Bouton unique de l'app — remplace les `<Button>` RN natifs (non stylables,
 * incohérents entre iOS/Android) utilisés partout dans les écrans "spike"
 * historiques. Retour au press (Phase 27 motion) : `scale(0.97)`, 120ms,
 * natif via `Animated` — aucune librairie ajoutée.
 */
export function AppButton({ title, onPress, variant = "primary", disabled = false, style, accessibilityHint }: AppButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => Animated.timing(scale, { toValue: 0.97, duration: 100, useNativeDriver: true }).start();
  const pressOut = () => Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: true }).start();

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [
          styles.base,
          VARIANT_STYLES[variant],
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <Text style={[styles.label, variant === "ghost" ? styles.labelGhost : styles.labelSolid]}>{title}</Text>
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
  label: { ...typography.bodyStrong },
  labelSolid: { color: colors.textOnPrimary },
  labelGhost: { color: colors.primary },
});
