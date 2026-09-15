import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import { RafEmptyState } from "../components/raf/RafEmptyState";
import { HistoryEntryRow } from "../components/history/HistoryEntryRow";
import { Icon } from "../components/ui/Icon";
import { ResultScreen } from "./result/ResultScreen";
import { mapHistoryEntryToResultViewModel } from "../history/to-result-view-model";
import { clearHistory, listHistory, removeHistoryEntry, toggleHistoryFavorite } from "../history/storage";
import type { HistoryEntry } from "../history/types";
import { colors, spacing, typography } from "../theme/tokens";

export interface HistoryScreenProps {
  /** Ouvre l'onglet Scanner — utilisé par le CTA de l'état vide (Phase 19, LOT "visual product pass" : "icon/title/explication/CTA", jamais un écran vide avec seulement une phrase grise). */
  onOpenScanner: () => void;
}

/**
 * Historique (LOT "beta product readiness", Phase 16/17/18 — polish
 * visuel LOT "visual product pass", Phase 17/19) — branché sur
 * `history/storage.ts` (persistence locale réelle). Le détail réutilise
 * `ResultScreen` tel quel (Phase 17 : "ne duplique pas l'écran de
 * résultat") via `history/to-result-view-model.ts`.
 */
export function HistoryScreen({ onOpenScanner }: HistoryScreenProps) {
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
        <RafEmptyState
          state="neutral"
          title="Aucune analyse pour l'instant"
          subtitle="Raf attend sa première mission."
          action={{ title: "Scanner un produit", onPress: onOpenScanner }}
        />
      </View>
    );
  }

  return (
    <View style={styles.listContainer}>
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Icon name="time" size={20} color={colors.textPrimary} />
          <Text style={styles.title}>Historique</Text>
        </View>
        <Text style={styles.clearAll} onPress={handleClearAll}>
          Effacer tout
        </Text>
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
  headerTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  clearAll: { ...typography.captionStrong, color: colors.textSecondary },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
});
