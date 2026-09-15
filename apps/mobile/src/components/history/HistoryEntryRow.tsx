import { Pressable, StyleSheet, Text, View } from "react-native";
import type { HistoryEntry } from "../../history/types";
import { formatMoneyRange } from "../../format/money";
import { formatAnalysisDate } from "../../format/date";
import { colors, radius, spacing, typography } from "../../theme/tokens";

export interface HistoryEntryRowProps {
  entry: HistoryEntry;
  onPress: () => void;
  onToggleFavorite: () => void;
  /** Suppression directe, sans confirmation (Phase 18 : "pas besoin de confirmation pour chaque item si UX swipe/delete simple") — distinct de "Effacer tout", qui exige lui une confirmation explicite (voir HistoryScreen.tsx). */
  onDelete: () => void;
}

/**
 * Ligne compacte partagée par Historique et Favoris (LOT "beta product
 * readiness", Phase 16/21 : "même état" entre les deux écrans) — produit,
 * set/numéro, verdict si connu, prix marché formaté, date, favori. Jamais
 * un mock : cette ligne ne reçoit que de vraies `HistoryEntry` persistées.
 */
export function HistoryEntryRow({ entry, onPress, onToggleFavorite, onDelete }: HistoryEntryRowProps) {
  const subtitleParts = [entry.identity.setName, entry.identity.collectorNumber ? `#${entry.identity.collectorNumber}` : null].filter(Boolean);

  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="button" accessibilityLabel={entry.identity.name ?? "Analyse"}>
      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {entry.identity.name ?? "Produit identifié"}
        </Text>
        {subtitleParts.length > 0 && <Text style={styles.subtitle}>{subtitleParts.join(" · ")}</Text>}
        <Text style={styles.date}>{formatAnalysisDate(entry.createdAt)}</Text>
      </View>
      <View style={styles.trailing}>
        <Text style={styles.value}>{entry.marketValue ? formatMoneyRange(entry.marketValue.low, entry.marketValue.high, entry.marketValue.currency) : "—"}</Text>
        <View style={styles.iconRow}>
          <Pressable onPress={onToggleFavorite} accessibilityRole="button" accessibilityLabel={entry.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} hitSlop={8}>
            <Text style={styles.favoriteIcon}>{entry.favorite ? "♥" : "♡"}</Text>
          </Pressable>
          <Pressable onPress={onDelete} accessibilityRole="button" accessibilityLabel="Supprimer" hitSlop={8}>
            <Text style={styles.deleteIcon}>🗑</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.md,
  },
  main: { flex: 1, gap: 2 },
  name: { ...typography.bodyStrong, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  date: { ...typography.caption, color: colors.textMuted },
  trailing: { alignItems: "flex-end", gap: spacing.xs },
  value: { ...typography.bodyStrong, color: colors.textPrimary },
  iconRow: { flexDirection: "row", gap: spacing.md },
  favoriteIcon: { fontSize: 20, color: colors.danger },
  deleteIcon: { fontSize: 16, opacity: 0.7 },
});
