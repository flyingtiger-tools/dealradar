import { StyleSheet, Text, View } from "react-native";
import { RafIllustration } from "./RafIllustration";
import type { RafState } from "../../theme/raf-mapping";
import { colors, spacing, typography } from "../../theme/tokens";

export interface RafResultHeroProps {
  state: RafState;
  headline: string;
  subheadline?: string;
}

/**
 * En-tête visuel de l'écran de résultat (Phase 8) — Raf dans l'état dérivé
 * de `raf-mapping.ts`, jamais choisi localement par l'écran. `headline` et
 * `subheadline` doivent toujours être construits à partir de données
 * réelles du résultat (nom du produit, statut) par l'écran appelant —
 * jamais un texte générique fixe ici.
 */
export function RafResultHero({ state, headline, subheadline }: RafResultHeroProps) {
  return (
    <View style={styles.container}>
      <RafIllustration state={state} size={120} />
      <Text style={styles.headline}>{headline}</Text>
      {subheadline && <Text style={styles.subheadline}>{subheadline}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  headline: { ...typography.title, color: colors.textPrimary, textAlign: "center" },
  subheadline: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
});
