import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { getRafAsset } from "../../assets/raf/registry";
import type { RafState } from "../../theme/raf-mapping";
import { radius } from "../../theme/tokens";

export interface RafIllustrationProps {
  state: RafState;
  size?: number;
  /** Pulsation douce (Phase 27, motion) — réservée aux états d'attente réels (analyzing/searching/scanning), jamais purement décorative sur un résultat statique. */
  pulse?: boolean;
}

/**
 * Grande illustration Raf (hero d'accueil, empty state, écran de résultat).
 * `pulse` anime une légère respiration d'échelle (1 → 1.05 → 1) en boucle
 * via l'API `Animated` native de React Native — aucune librairie ajoutée
 * (Phase 27 : "pas de grosse librairie si inutile").
 */
export function RafIllustration({ state, size = 160, pulse = false }: RafIllustrationProps) {
  const asset = getRafAsset(state);
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.05, duration: 900, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, scale]);

  const fontSize = Math.round(size * 0.45);
  return (
    <Animated.View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: radius.pill, backgroundColor: asset.backgroundColor, transform: [{ scale }] },
      ]}
      accessible
      accessibilityLabel={asset.accessibilityLabel}
      accessibilityRole="image"
    >
      <Text style={{ fontSize }}>{asset.emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center", alignSelf: "center" },
});
