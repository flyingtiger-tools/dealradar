import { StyleSheet, Text, View } from "react-native";
import type { HeroPriceRange } from "../../screens/result/price-hero";
import { formatMoneyRange } from "../../format/money";
import { colors, typography } from "../../theme/tokens";

export interface PriceHeroProps {
  range: HeroPriceRange | null;
}

/**
 * Prix affiché comme l'élément le plus visible de l'écran de résultat
 * (Phase 11, LOT "visual product pass") — `typography.metric`, devise
 * claire. Absence de prix : "Prix indisponible" explicite, jamais
 * `0 €`/`NaN`/`—` (règle déjà en place ailleurs dans l'app, appliquée ici
 * à la position la plus visible de l'écran).
 */
export function PriceHero({ range }: PriceHeroProps) {
  if (!range) {
    return (
      <View style={styles.container}>
        <Text style={styles.unavailable}>Prix indisponible</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.amount}>{formatMoneyRange(range.low, range.high, range.currency)}</Text>
      <Text style={styles.label}>Valeur de marché estimée</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", gap: 2 },
  amount: { ...typography.metric, color: colors.textPrimary },
  unavailable: { ...typography.title, color: colors.textMuted },
  label: { ...typography.caption, color: colors.textSecondary },
});
