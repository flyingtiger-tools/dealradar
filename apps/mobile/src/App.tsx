import { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet, Text } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { getCurrentSession, onSessionChange } from "./auth/session";
import { LoginScreen } from "./screens/LoginScreen";
import { RootNavigator } from "./navigation/RootNavigator";
import { colors, typography } from "./theme/tokens";

/**
 * Racine de l'app (ADR 0010, LOT 8, authentification réelle LOT 9 — puis
 * LOT "fondation produit Raf", Phase 1 : App.tsx redevient petit, toute la
 * navigation/les écrans vivent sous `navigation/`/`screens/`).
 *
 * Authentification INCHANGÉE (Phase 1 : "ne fais pas de refactor massif si
 * inutile") : `session === undefined` pendant la vérification initiale,
 * `null` sans session active → `LoginScreen`, un objet `Session` →
 * `RootNavigator`. `onSessionChange` réagit à toute connexion/déconnexion/
 * rafraîchissement/expiration, exactement comme avant ce lot.
 */
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

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

  return <RootNavigator session={session} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  loadingText: { ...typography.body, color: colors.textSecondary },
});
