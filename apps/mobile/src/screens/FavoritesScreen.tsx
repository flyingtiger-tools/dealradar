import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { RafEmptyState } from "../components/raf/RafEmptyState";
import { HistoryEntryRow } from "../components/history/HistoryEntryRow";
import { Icon } from "../components/ui/Icon";
import { ResultScreen } from "./result/ResultScreen";
import { mapHistoryEntryToResultViewModel } from "../history/to-result-view-model";
import { listHistory, removeHistoryEntry, toggleHistoryFavorite } from "../history/storage";
import type { HistoryEntry } from "../history/types";
import { colors, spacing, typography } from "../theme/tokens";

export interface FavoritesScreenProps {
  /** Ouvre l'onglet Historique — utilisé par le CTA de l'état vide (Phase 19, LOT "visual product pass") : le chemin réel vers un favori passe par l'historique, jamais par un scan direct. */
  onOpenHistory: () => void;
}

/**
 * Favoris (LOT "beta product readiness", Phase 19/20/21 — polish visuel
 * LOT "visual product pass", Phase 18) — stratégie A (Phase 19) : un
 * simple drapeau `favorite` sur `HistoryEntry`, jamais un second dépôt qui
 * dupliquerait les mêmes données. Réutilise `HistoryEntryRow` tel quel
 * (Phase 18 : "ne duplique pas inutilement les composants") — la seule
 * différenciation visuelle avec Historique est l'icône/titre d'en-tête
 * (étoile pleine plutôt qu'horloge), le contexte reste clairement
 * distinct sans dupliquer la ligne elle-même.
 */
export function FavoritesScreen({ onOpenHistory }: FavoritesScreenProps) {
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
        <RafEmptyState
          state="neutral"
          title="Aucun favori pour l'instant"
          subtitle="Garde un œil sur les produits qui t'intéressent."
          action={{ title: "Voir l'historique", onPress: onOpenHistory }}
        />
      </View>
    );
  }

  return (
    <View style={styles.listContainer}>
      <View style={styles.header}>
        <Icon name="star" size={20} color={colors.primary} />
        <Text style={styles.title}>Favoris</Text>
      </View>
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
});
