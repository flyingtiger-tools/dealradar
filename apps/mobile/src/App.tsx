import { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet, Text } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { getCurrentSession, onSessionChange } from "./auth/session";
import { LoginScreen } from "./screens/LoginScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { RootNavigator } from "./navigation/RootNavigator";
import { isOnboardingCompleted, setOnboardingCompleted } from "./onboarding/onboarding-storage";
import { colors, typography } from "./theme/tokens";

/**
 * Racine de l'app (ADR 0010, LOT 8, authentification réelle LOT 9 — puis
 * LOT "fondation produit Raf", Phase 1 : App.tsx redevient petit — puis
 * LOT "beta product readiness", Phase 30 : gate onboarding).
 *
 * Authentification INCHANGÉE (Phase 1 : "ne fais pas de refactor massif si
 * inutile") : `session === undefined` pendant la vérification initiale,
 * `null` sans session active → `LoginScreen`, un objet `Session` → on
 * vérifie ENSUITE l'onboarding, jamais avant — `onboarding-storage.ts` ne
 * dépend jamais de `auth/session.ts` et inversement, ce gate additionnel
 * ne touche donc jamais la logique de session elle-même.
 *
 * `onboardingCompleted === undefined` : lecture en cours (AsyncStorage,
 * asynchrone) — même état "chargement" que la vérification de session,
 * jamais un flash de contenu incorrect.
 */
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [onboardingCompleted, setOnboardingCompletedState] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getCurrentSession().then((current) => {
      if (!cancelled) setSession(current);
    });
    const unsubscribe = onSessionChange(setSession);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    isOnboardingCompleted().then((completed) => {
      if (!cancelled) setOnboardingCompletedState(completed);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (session === undefined) {
    return (
      <SafeAreaView style={styles.loading}>
        <Text style={styles.loadingText}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  if (session === null) {
    return <LoginScreen />;
  }

  if (onboardingCompleted === undefined) {
    return (
      <SafeAreaView style={styles.loading}>
        <Text style={styles.loadingText}>Chargement…</Text>
      </SafeAreaView>
    );
  }

  if (!onboardingCompleted) {
    return (
      <OnboardingScreen
        onDone={() => {
          void setOnboardingCompleted(true);
          setOnboardingCompletedState(true);
        }}
      />
    );
  }

  return <RootNavigator session={session} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  loadingText: { ...typography.body, color: colors.textSecondary },
});
