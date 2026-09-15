import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { RafIllustration } from "../components/raf/RafIllustration";
import { AppButton } from "../components/ui/AppButton";
import type { RafState } from "../theme/raf-mapping";
import { colors, spacing, typography } from "../theme/tokens";

export interface OnboardingScreenProps {
  onDone: () => void;
}

interface OnboardingStep {
  state: RafState;
  text: string;
}

const STEPS: OnboardingStep[] = [
  { state: "happy", text: "Salut, moi c'est Raf." },
  { state: "scanning", text: "Scanne ou partage un produit." },
  { state: "searching", text: "Je compare le marché." },
  { state: "goodDeal", text: "Tu sais quand acheter, attendre ou vendre." },
];

/**
 * Onboarding (Phase 21) — structure prête, 4 écrans max, PAS ENCORE
 * branché sur le flux d'authentification (`App.tsx`/`RootNavigator.tsx`
 * ne l'affichent jamais automatiquement aujourd'hui) : le brancher
 * demanderait de décider où stocker "déjà vu" (AsyncStorage ? profil
 * Supabase ?) et de le tester sur le vrai flux de session — hors périmètre
 * de ce lot ("ne force pas encore l'affichage si cela risque de casser
 * auth/session"). Reste consultable depuis Outils internes → "Onboarding
 * (aperçu)" en attendant.
 */
export function OnboardingScreen({ onDone }: OnboardingScreenProps) {
  const [index, setIndex] = useState(0);
  // STEPS est un tableau constant non vide et `index` toujours dans ses
  // bornes (voir la clause `isLast` ci-dessous) — l'assertion non-nulle est
  // sûre ici, jamais un accès hors bornes réel.
  const step = (STEPS[index] ?? STEPS[0])!;
  const isLast = index === STEPS.length - 1;

  return (
    <View style={styles.container}>
      <RafIllustration state={step.state} size={160} />
      <Text style={styles.text}>{step.text}</Text>

      <View style={styles.dots}>
        {STEPS.map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <AppButton title={isLast ? "Commencer" : "Suivant"} onPress={() => (isLast ? onDone() : setIndex((i) => i + 1))} />
      {!isLast && <AppButton title="Passer" onPress={onDone} variant="ghost" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl, padding: spacing.xl, backgroundColor: colors.background },
  text: { ...typography.title, color: colors.textPrimary, textAlign: "center" },
  dots: { flexDirection: "row", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary },
});
