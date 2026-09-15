import { View, StyleSheet } from "react-native";
import { RafEmptyState } from "../components/raf/RafEmptyState";
import { colors } from "../theme/tokens";

/** Favoris (Phase 13) — aucun backend de favoris n'existe aujourd'hui ; UI simple, état vide, aucun nouveau backend créé (comme demandé). */
export function FavoritesScreen() {
  return (
    <View style={styles.container}>
      <RafEmptyState state="neutral" title="Aucun favori pour l'instant" subtitle="Garde un œil sur les produits qui t'intéressent." />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: "center" },
});
