import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { RafEmptyState } from "../components/raf/RafEmptyState";
import { HistoryEntryRow } from "../components/history/HistoryEntryRow";
import { AppButton } from "../components/ui/AppButton";
import { ResultScreen } from "./result/ResultScreen";
import { mapHistoryEntryToResultViewModel } from "../history/to-result-view-model";
import { clearHistory, listHistory, removeHistoryEntry, toggleHistoryFavorite } from "../history/storage";
import type { HistoryEntry } from "../history/types";
import { colors, spacing, typography } from "../theme/tokens";

/**
 * Historique (LOT "beta product readiness", Phase 16/17/18) — branché sur
 * `history/storage.ts` (persistence locale réelle), plus un simple état
 * vide permanent. Le détail réutilise `ResultScreen` tel quel (Phase 17 :
 * "ne duplique pas l'écran de résultat") via
 * `history/to-result-view-model.ts`.
 */
export function HistoryScreen() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setEntries(await listHistory());
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

  // "Effacer tout" exige une confirmation explicite (Phase 18) — jamais le
  // cas pour la suppression d'un seul élément (voir HistoryEntryRow).
  const handleClearAll = useCallback(() => {
    Alert.alert("Effacer l'historique ?", "Cette action est irréversible.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Effacer",
        style: "destructive",
        onPress: () => {
          void clearHistory().then(refresh);
        },
      },
    ]);
  }, [refresh]);

  if (entries === null) {
    return <View style={styles.container} />;
  }

  const selected = selectedId ? entries.find((e) => e.id === selectedId) ?? null : null;
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

  if (entries.length === 0) {
    return (
      <View style={styles.container}>
        <RafEmptyState state="neutral" title="Aucune analyse pour l'instant" subtitle="Raf attend sa première mission." />
      </View>
    );
  }

  return (
    <View style={styles.listContainer}>
      <View style={styles.header}>
        <Text style={styles.title}>Historique</Text>
        <AppButton title="Effacer tout" onPress={handleClearAll} variant="ghost" />
      </View>
      <FlatList
        data={entries}
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
});
