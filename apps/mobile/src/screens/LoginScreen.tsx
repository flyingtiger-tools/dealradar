import { useCallback, useState } from "react";
import { SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { signInWithPassword } from "../auth/session";
import { AppButton } from "../components/ui/AppButton";
import { colors, radius, spacing, typography } from "../theme/tokens";

/**
 * Écran de connexion (LOT 9, restylé LOT "package visuel Raf" — Phase
 * "cohérence des tokens" : aucune couleur codée en dur, `AppButton` au
 * lieu du `<Button>` natif). Authentification Supabase réelle uniquement
 * (`signInWithPassword`), logique INCHANGÉE — aucune couleur codée en dur,
 * `AppButton` au lieu du `<Button>` natif. Aucune clé serveur, aucun
 * secret ici, seule la clé publique "anon" déjà configurée dans le client
 * partagé est utilisée. La session résultante est gérée entièrement par
 * le SDK Supabase (`App.tsx` s'abonne à `onSessionChange`) ; cet écran ne
 * stocke rien lui-même.
 */
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    if (!email || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await signInWithPassword(email.trim(), password);
      if (result.error) setError(result.error);
      // Succès : `App.tsx` réagit automatiquement via `onSessionChange`,
      // rien à faire ici (aucune navigation manuelle).
    } finally {
      setSubmitting(false);
    }
  }, [email, password]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>DealRadar</Text>
      <Text style={styles.subtitle}>Connecte-toi pour continuer</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          accessibilityLabel="Email"
        />
        <TextInput
          style={styles.input}
          placeholder="Mot de passe"
          placeholderTextColor={colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          accessibilityLabel="Mot de passe"
        />
        <AppButton
          title={submitting ? "Connexion…" : "Se connecter"}
          onPress={handleSignIn}
          disabled={submitting || !email || !password}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: "center", backgroundColor: colors.background },
  title: { ...typography.display, color: colors.textPrimary, textAlign: "center" },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: "center", marginBottom: spacing.sm },
  form: { gap: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  error: { ...typography.body, color: colors.danger, textAlign: "center" },
});
