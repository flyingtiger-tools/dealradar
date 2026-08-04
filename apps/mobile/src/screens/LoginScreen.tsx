import { useCallback, useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { signInWithPassword } from "../auth/session";

/**
 * Écran de connexion (LOT 9) — remplace définitivement le champ "Jeton
 * d'accès (dev uniquement)". Authentification Supabase réelle uniquement
 * (`signInWithPassword`) — aucune clé serveur, aucun secret ici, seule la
 * clé publique "anon" déjà configurée dans le client partagé est utilisée.
 * La session résultante est gérée entièrement par le SDK Supabase
 * (`App.tsx` s'abonne à `onSessionChange`) ; cet écran ne stocke rien
 * lui-même.
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
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Mot de passe"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
        />
        <Button title={submitting ? "Connexion…" : "Se connecter"} onPress={handleSignIn} disabled={submitting || !email || !password} />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#666", textAlign: "center", marginBottom: 8 },
  form: { gap: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 12 },
  error: { color: "#b91c1c", textAlign: "center" },
});
