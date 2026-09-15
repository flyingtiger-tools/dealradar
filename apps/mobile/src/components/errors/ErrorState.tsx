import { StyleSheet, Text, View } from "react-native";
import { RafIllustration } from "../raf/RafIllustration";
import { cleanUserMessage } from "../../identification/user-messages";
import { colors, spacing, typography } from "../../theme/tokens";
import { AppButton } from "../ui/AppButton";

/**
 * États d'erreur "connus" (Phase 18) — structurels, pas des messages
 * réseau bruts : l'écran appelant les choisit directement à partir de son
 * propre état (session absente, confiance basse, aucun prix), il n'y a
 * rien à "nettoyer" ici, contrairement à `kind: "message"` ci-dessous.
 *
 * Ce composant ne doit JAMAIS afficher : "Network request failed",
 * "status: failed", "pokemon_tcg", ou une pile d'erreur brute — voir
 * `identification/user-messages.ts`, déjà chargé de cette règle pour les
 * messages bruts, réutilisé ici plutôt que dupliqué.
 */
export type KnownErrorCode =
  | "NETWORK_UNAVAILABLE"
  | "BACKEND_UNAVAILABLE"
  | "ANALYSIS_TIMEOUT"
  | "AUTH_REQUIRED"
  | "UPLOAD_FAILED"
  | "LOW_CONFIDENCE"
  | "NO_PRICE";

const CODE_COPY: Record<KnownErrorCode, { title: string; message: string }> = {
  NETWORK_UNAVAILABLE: { title: "Pas de connexion", message: "Connexion nécessaire pour analyser le marché." },
  BACKEND_UNAVAILABLE: { title: "Service indisponible", message: "Le service est momentanément indisponible — réessaie dans un instant." },
  ANALYSIS_TIMEOUT: { title: "Ça prend plus de temps que prévu", message: "L'analyse met plus de temps que prévu — réessaie dans un instant." },
  AUTH_REQUIRED: { title: "Connexion nécessaire", message: "Reconnecte-toi pour continuer." },
  UPLOAD_FAILED: { title: "Envoi impossible", message: "La photo n'a pas pu être envoyée — réessaie." },
  LOW_CONFIDENCE: { title: "Identification incertaine", message: "Raf n'est pas sûr de cette identification — vérifie ou reprends la photo." },
  NO_PRICE: { title: "Prix indisponible", message: "Prix temporairement indisponible pour ce produit." },
};

export type ErrorStateSource = { kind: "code"; code: KnownErrorCode } | { kind: "message"; raw: string };

/**
 * Résolution pure source -> {titre, message} — extraite de `ErrorState`
 * pour être testable sans rendre de composant (voir
 * `__tests__/error-state-copy.test.ts`, Phase 30 "error states").
 */
export function resolveErrorCopy(source: ErrorStateSource): { title: string; message: string } {
  if (source.kind === "code") return CODE_COPY[source.code];
  return { title: "Un problème est survenu", message: cleanUserMessage(source.raw) ?? source.raw };
}

export interface ErrorStateProps {
  source: ErrorStateSource;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ source, onRetry, retryLabel = "Réessayer" }: ErrorStateProps) {
  const { title, message } = resolveErrorCopy(source);

  return (
    <View style={styles.container}>
      <RafIllustration state="warning" size={96} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && <AppButton title={retryLabel} onPress={onRetry} variant="secondary" style={styles.action} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.xl },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: "center" },
  message: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  action: { marginTop: spacing.sm },
});
