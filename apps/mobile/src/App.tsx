import { Component, useEffect, useState, type ReactNode } from "react";
import { SafeAreaView, StatusBar, StyleSheet, Text } from "react-native";
import { TcgScanScreen } from "./screens/TcgScanScreen";
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
 *
 * `StatusBar` (cœur React Native, aucune dépendance ajoutée — `expo-
 * status-bar` n'est pas installé dans ce projet) : rendue UNE SEULE fois
 * ici, en tête de chaque branche, plutôt que dupliquée par écran — le
 * thème est exclusivement sombre (voir theme/tokens.ts), donc toujours
 * `barStyle="light-content"` (icônes claires) et un fond identique à
 * `colors.background`, jamais la barre blanche par défaut d'Android
 * observée en QA device réel (LOT "device QA + first real scan",
 * 2026-09-15) sur CHAQUE écran avant ce correctif.
 */
const directTcgTest = process.env.EXPO_PUBLIC_DIAGNOSTIC_APK === "true";

class VisibleErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error?.message ?? String(error) };
  }

  render() {
    if (this.state.message) {
      return (
        <SafeAreaView style={styles.loading}>
          <Text style={styles.loadingText}>L'application a rencontré une erreur :</Text>
          <Text selectable style={styles.loadingText}>{this.state.message}</Text>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [onboardingCompleted, setOnboardingCompletedState] = useState<boolean | undefined>(undefined);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentSession().then((current) => {
      if (!cancelled) setSession(current);
    }).catch((error: unknown) => {
      if (!cancelled) setStartupError(error instanceof Error ? error.message : String(error));
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

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <VisibleErrorBoundary>{renderBody()}</VisibleErrorBoundary>
    </>
  );

  function renderBody() {
    if (startupError) {
      return (
        <SafeAreaView style={styles.loading}>
          <Text style={styles.loadingText}>Erreur au démarrage : {startupError}</Text>
        </SafeAreaView>
      );
    }

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

    // APK de diagnostic : accès direct au scan, sans passer par l'accueil ni
    // l'introduction, pour isoler l'écran blanc observé après connexion.
    if (directTcgTest) return <TcgScanScreen />;

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
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  loadingText: { ...typography.body, color: colors.textSecondary },
});
