import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors, radius } from "../../theme/tokens";

export interface RadarPulseProps {
  size?: number;
  /** Anneaux qui respirent en boucle (Phase 5/9 : "market pulse / scan beam") — réservé aux moments d'attente réels (chargement) ou décoratifs (hero d'accueil, jamais un résultat statique). */
  animated?: boolean;
}

/**
 * Composition abstraite "radar" (anneaux concentriques + point central) —
 * remplace un illustration Raf par un signal purement géométrique là où le
 * brief demande un hero visuel SANS Raf (Phase 5, LOT "visual product
 * pass") : "radar / rings / signal / market pulse / scan beam". Uniquement
 * des primitives `View`/`Animated` déjà utilisées ailleurs dans l'app
 * (`RafIllustration` fait déjà un pulse identique) — aucune dépendance
 * ajoutée (pas de SVG, pas de librairie graphique).
 */
export function RadarPulse({ size = 220, animated = true }: RadarPulseProps) {
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) return;
    const makeLoop = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const loop1 = makeLoop(ring1, 0);
    const loop2 = makeLoop(ring2, 1100);
    loop1.start();
    loop2.start();
    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [animated, ring1, ring2]);

  const ringStyle = (value: Animated.Value) => ({
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {animated && (
        <>
          <Animated.View style={[styles.ring, { width: size, height: size }, ringStyle(ring1)]} />
          <Animated.View style={[styles.ring, { width: size, height: size }, ringStyle(ring2)]} />
        </>
      )}
      <View style={[styles.ringStatic, { width: size * 0.68, height: size * 0.68 }]} />
      <View style={[styles.ringStatic, { width: size * 0.42, height: size * 0.42 }]} />
      <View style={[styles.core, { width: size * 0.18, height: size * 0.18 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
  ringStatic: { position: "absolute", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.borderStrong },
  core: { borderRadius: radius.pill, backgroundColor: colors.primary },
});
