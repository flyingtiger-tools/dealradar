import { useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { Icon } from "../ui/Icon";
import { colors, radius, shadows } from "../../theme/tokens";

export interface ShutterButtonProps {
  onPress: () => void;
  accessibilityLabel?: string;
}

/**
 * Bouton de capture façon appareil photo natif (Phase 7 : "bouton shutter
 * propre") — cercle plein, anneau clair autour, retour au press identique
 * à `AppButton` (`scale(0.97)`, ~100-160ms). Une seule instance dans
 * l'app : `CaptureGuideScreen`.
 */
export function ShutterButton({ onPress, accessibilityLabel = "Prendre une photo" }: ShutterButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.timing(scale, { toValue: 0.95, duration: 100, useNativeDriver: true }).start();
  const pressOut = () => Animated.timing(scale, { toValue: 1, duration: 140, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={styles.ring}
      >
        <Animated.View style={styles.core}>
          <Icon name="camera" size={28} color={colors.textOnPrimary} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const SIZE = 76;

const styles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.raised,
  },
  core: {
    width: SIZE - 16,
    height: SIZE - 16,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
