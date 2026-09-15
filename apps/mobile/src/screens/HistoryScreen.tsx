import { View, StyleSheet } from "react-native";
import { RafEmptyState } from "../components/raf/RafEmptyState";
import { colors } from "../theme/tokens";

/**
 * Historique (Phase 12) — aucun backend d'historique d'analyses n'existe
 * aujourd'hui (recherche effectuée : aucune route `/v1/analyses` de liste,
 * seulement création + lecture par id). État vide honnête plutôt qu'une
 * donnée fabriquée — voir docs/mobile/ui-product-foundation.md.
 */
export function HistoryScreen() {
  return (
    <View style={styles.container}>
      <RafEmptyState state="neutral" title="Aucune analyse pour l'instant" subtitle="Raf attend sa première mission." />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: "center" },
});
