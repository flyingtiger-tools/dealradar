import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { RootTab } from "./types";
import { colors, radius, spacing, typography } from "../theme/tokens";

const TABS: { key: RootTab; label: string; emoji: string }[] = [
  { key: "home", label: "Accueil", emoji: "🏠" },
  { key: "history", label: "Historique", emoji: "🕓" },
  { key: "scanner", label: "Scanner", emoji: "📷" },
  { key: "favorites", label: "Favoris", emoji: "⭐" },
  { key: "profile", label: "Profil", emoji: "👤" },
];

export interface BottomTabBarProps {
  active: RootTab;
  onSelect: (tab: RootTab) => void;
}

/**
 * Barre d'onglets consommateur (Phase 3) — 5 onglets fixes, Scanner
 * visuellement prioritaire (bouton central surélevé, couleur primaire).
 * Implémentation "maison" (View/Pressable), volontairement sans
 * `@react-navigation` : éviter une dépendance native supplémentaire tant
 * que le build natif (`apps/mobile/android/`) n'est pas vérifiable dans cet
 * environnement (voir docs/mobile/ui-product-foundation.md, section
 * "APK") — n'importe quelle bibliothèque de navigation native aurait
 * nécessité une régénération native non vérifiable aujourd'hui.
 */
export function BottomTabBar({ active, onSelect }: BottomTabBarProps) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isScanner = tab.key === "scanner";
        const isActive = active === tab.key;
        if (isScanner) {
          return (
            <Pressable
              key={tab.key}
              onPress={() => onSelect(tab.key)}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              style={styles.scannerButton}
              hitSlop={8}
            >
              <Text style={styles.scannerEmoji}>{tab.emoji}</Text>
            </Pressable>
          );
        }
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
            style={styles.tabButton}
            hitSlop={8}
          >
            <Text style={styles.emoji}>{tab.emoji}</Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    paddingTop: spacing.sm,
    // Marge basse supplémentaire sur Android : sans `react-native-safe-
    // area-context` (non installé — aucune dépendance native ajoutée tant
    // que le build natif n'est pas vérifiable, voir
    // docs/mobile/ui-product-foundation.md), impossible de lire la hauteur
    // exacte de la barre de navigation gestuelle. Cette marge fixe évite
    // au moins que les onglets ne soient collés au bord — approximation
    // documentée, pas une valeur précise par appareil.
    paddingBottom: Platform.OS === "android" ? spacing.lg : spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tabButton: { alignItems: "center", gap: 2, minWidth: 56, minHeight: 48, justifyContent: "center" },
  emoji: { fontSize: 20 },
  label: { ...typography.caption, color: colors.textMuted },
  labelActive: { color: colors.primary },
  scannerButton: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -24,
    borderWidth: 4,
    borderColor: colors.surface,
  },
  scannerEmoji: { fontSize: 26 },
});
