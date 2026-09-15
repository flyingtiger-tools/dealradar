import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { RafIllustration } from "../components/raf/RafIllustration";
import { AppButton } from "../components/ui/AppButton";
import type { RafState } from "../theme/raf-mapping";
import { colors, radius, spacing, typography } from "../theme/tokens";

export interface OnboardingScreenProps {
  onDone: () => void;
}

interface OnboardingStep {
  state: RafState;
  title: string;
  text: string;
}

// 3 étapes maximum (Phase 6, LOT "visual product pass" : "gros titre + 1
// phrase, pas de paragraphe, pas de mascotte fake") — un titre marquant
// plutôt qu'une simple phrase d'accroche, chaque étape ne portant qu'UNE
// idée (scanner / comprendre / décider).
const STEPS: OnboardingStep[] = [
  { state: "scanning", title: "Scanne", text: "Prends en photo n'importe quelle carte." },
  { state: "searching", title: "Comprends le marché", text: "Raf compare les prix en un instant." },
  { state: "goodDeal", title: "Sache quand acheter", text: "Un verdict clair : acheter, attendre, ou passer." },
];

/**
 * Onboarding (Phase 6, LOT "visual product pass") — 3 étapes réelles,
 * titre + phrase + progress indicator + CTA évident. Toujours PAS ENCORE
 * forcé sur le flux d'authentification par ce fichier lui-même :
 * `App.tsx` (LOT "beta product readiness", Phase 30) décide seul du
 * moment où l'afficher — ce composant reste purement présentationnel.
 */
export function OnboardingScreen({ onDone }: OnboardingScreenProps) {
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [index, fade]);

  // STEPS est un tableau constant non vide et `index` toujours dans ses
  // bornes (voir la clause `isLast` ci-dessous) — l'assertion non-nulle est
  // sûre ici, jamais un accès hors bornes réel.
  const step = (STEPS[index] ?? STEPS[0])!;
  const isLast = index === STEPS.length - 1;

  return (
    <View style={styles.container}>
      <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Passer l'introduction" style={styles.skip}>
        <Text style={styles.skipLabel}>Passer</Text>
      </Pressable>

      <Animated.View style={[styles.content, { opacity: fade }]}>
        <RafIllustration state={step.state} size={140} />
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.text}>{step.text}</Text>
      </Animated.View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <AppButton title={isLast ? "Commencer" : "Suivant"} onPress={() => (isLast ? onDone() : setIndex((i) => i + 1))} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "space-between", padding: spacing.xl, backgroundColor: colors.background },
  skip: { alignSelf: "flex-end", padding: spacing.sm },
  skipLabel: { ...typography.body, color: colors.textSecondary },
  content: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  title: { ...typography.hero, color: colors.textPrimary, textAlign: "center" },
  text: { ...typography.subtitle, color: colors.textSecondary, textAlign: "center" },
  footer: { gap: spacing.lg },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  dotActive: { width: 22, backgroundColor: colors.primary },
});
