import { StyleSheet, Text, View } from "react-native";
import { RafAvatar } from "./RafAvatar";
import type { RafState } from "../../theme/raf-mapping";
import { colors, radius, spacing, typography } from "../../theme/tokens";

export interface RafMessageProps {
  state: RafState;
  /** Toujours un texte lié à un état réel — jamais un "insight" fabriqué (Phase 6 : "Pas de fake insight"). */
  message: string;
}

/** Petite bulle "Raf dit quelque chose" — hero d'accueil, avertissement de preview, message d'étape. */
export function RafMessage({ state, message }: RafMessageProps) {
  return (
    <View style={styles.row}>
      <RafAvatar state={state} size={48} />
      <View style={styles.bubble}>
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  bubble: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: { ...typography.body, color: colors.textPrimary },
});
