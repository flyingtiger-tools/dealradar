import { StyleSheet, Text, View } from "react-native";
import { RafIllustration } from "../raf/RafIllustration";
import { cleanUserMessage } from "../../identification/user-messages";
import { mapAnalysisErrorToUserMessage, type AnalysisErrorCode, type AnalysisErrorInfo } from "../../domain/analysis-errors";
import { colors, spacing, typography } from "../../theme/tokens";
import { AppButton } from "../ui/AppButton";

/**
 * États d'erreur "connus" (Phase 18 du lot précédent, Phase 8/9 du LOT
 * "beta product readiness") — structurels, pas des messages réseau
 * bruts : l'écran appelant les choisit directement à partir de son propre
 * état (session absente, confiance basse, aucun prix). Délègue
 * entièrement à `domain/analysis-errors.ts` (`mapAnalysisErrorToUserMessage`)
 * — SOURCE UNIQUE de la taxonomie, jamais un second tableau ici.
 *
 * Ce composant ne doit JAMAIS afficher : "Network request failed",
 * "status: failed", "pokemon_tcg", ou une pile d'erreur brute — voir
 * `identification/user-messages.ts`, déjà chargé de cette règle pour les
 * messages bruts, réutilisé ici plutôt que dupliqué.
 */
export type ErrorStateSource = { kind: "code"; code: AnalysisErrorCode } | { kind: "message"; raw: string };

/**
 * Résolution pure source -> {titre, message, retryable, suggestedAction} —
 * testable sans rendre de composant (voir `__tests__/error-state-copy.test.ts`).
 */
export function resolveErrorCopy(source: ErrorStateSource): AnalysisErrorInfo {
  if (source.kind === "code") return mapAnalysisErrorToUserMessage(source.code);
  const message = cleanUserMessage(source.raw) ?? source.raw;
  return { code: "UNKNOWN_ERROR", title: "Un problème est survenu", message, retryable: true, suggestedAction: null };
}

export interface ErrorStateProps {
  source: ErrorStateSource;
  onRetry?: () => void;
  retryLabel?: string;
}

/** N'affiche le bouton "réessayer" que si `onRetry` est fourni ET que le code est réellement `retryable` (Phase 9/11 : jamais un bouton "réessayer" pour AUTH_REQUIRED ou NO_PRICE, qui ne changeront pas par un simple nouvel essai). */
export function ErrorState({ source, onRetry, retryLabel = "Réessayer" }: ErrorStateProps) {
  const info = resolveErrorCopy(source);

  return (
    <View style={styles.container}>
      <RafIllustration state="warning" size={96} />
      <Text style={styles.title}>{info.title}</Text>
      <Text style={styles.message}>{info.message}</Text>
      {info.suggestedAction && <Text style={styles.suggestedAction}>{info.suggestedAction}</Text>}
      {onRetry && info.retryable && <AppButton title={retryLabel} onPress={onRetry} variant="secondary" style={styles.action} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.xl },
  title: { ...typography.subtitle, color: colors.textPrimary, textAlign: "center" },
  message: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  suggestedAction: { ...typography.caption, color: colors.textMuted, textAlign: "center" },
  action: { marginTop: spacing.sm },
});
