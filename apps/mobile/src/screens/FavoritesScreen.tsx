import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { RafEmptyState } from "../components/raf/RafEmptyState";
import { HistoryEntryRow } from "../components/history/HistoryEntryRow";
import { ResultScreen } from "./result/ResultScreen";
import { mapHistoryEntryToResultViewModel } from "../history/to-result-view-model";
import { listHistory, removeHistoryEntry, toggleHistoryFavorite } from "../history/storage";
import type { HistoryEntry } from "../history/types";
import { colors, spacing, typography } from "../theme/tokens";

/**
 * Favoris (LOT "beta product readiness", Phase 19/20/21) — stratégie A
 * (Phase 19) : un simple drapeau `favorite` sur `HistoryEntry`, jamais un
 * second dépôt qui dupliquerait les mêmes données (`FavoriteRepository`
 * séparé aurait exigé de garder deux copies synchronisées). Cet écran ne
 * fait qu'un `listHistory()` filtré — la source de vérité reste
 * `history/storage.ts`, jamais un état parallèle.
 */
export function FavoritesScreen() {
  const [favorites, setFavorites] = useState<HistoryEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await listHistory();
    setFavorites(all.filter((entry) => entry.favorite));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggleFavorite = useCallback(
    async (id: string) => {
      await toggleHistoryFavorite(id);
      await refresh();
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await removeHistoryEntry(id);
      await refresh();
    },
    [refresh],
  );

  if (favorites === null) {
    return <View style={styles.container} />;
  }

  const selected = selectedId ? favorites.find((e) => e.id === selectedId) ?? null : null;
  if (selected) {
    return (
      <ResultScreen
        view={mapHistoryEntryToResultViewModel(selected)}
        onScanAnother={() => setSelectedId(null)}
        onExit={() => setSelectedId(null)}
        historyEntryId={selected.id}
        initialFavorite={selected.favorite}
      />
    );
  }

  if (favorites.length === 0) {
    return (
      <View style={styles.container}>
        <RafEmptyState state="neutral" title="Aucun favori pour l'instant" subtitle="Garde un œil sur les produits qui t'intéressent." />
      </View>
    );
  }

  return (
    <View style={styles.listContainer}>
      <Text style={styles.title}>Favoris</Text>
      <FlatList
        data={favorites}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <HistoryEntryRow
            entry={item}
            onPress={() => setSelectedId(item.id)}
            onToggleFavorite={() => void handleToggleFavorite(item.id)}
            onDelete={() => void handleDelete(item.id)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: "center" },
  listContainer: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary, padding: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
});
