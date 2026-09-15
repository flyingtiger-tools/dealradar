import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { borderWidth, colors, radius, shadows, spacing } from "../../theme/tokens";

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** `surface` (défaut) : contenu informatif au repos. `raised` : flotte visuellement au-dessus (hero, modale-like) — ombre plus marquée, jamais utilisé pour une simple liste de rangées (Phase 25 : hiérarchie de surfaces, pas de card-in-card). */
  variant?: "surface" | "raised";
}

/** Conteneur "carte" partagé — surface légèrement plus claire que le fond, coins arrondis, ombre légère. Utilisé par toutes les sections d'écran (Phase 2 : ne pas hardcoder les couleurs partout). */
export function Card({ children, style, padded = true, variant = "surface" }: CardProps) {
  return <View style={[styles.card, variant === "raised" ? styles.raised : styles.surface, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: borderWidth.thin,
    borderColor: colors.borderSubtle,
  },
  surface: { backgroundColor: colors.surface, ...shadows.card },
  raised: { backgroundColor: colors.surfaceRaised, ...shadows.raised },
  padded: { padding: spacing.lg },
});
