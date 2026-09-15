import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { RootTab } from "./types";
import { Icon, type IconName } from "../components/ui/Icon";
import { colors, radius, shadows, spacing, typography } from "../theme/tokens";

const TABS: { key: RootTab; label: string; icon: IconName; iconActive: IconName }[] = [
  { key: "home", label: "Accueil", icon: "home-outline", iconActive: "home" },
  { key: "history", label: "Historique", icon: "time-outline", iconActive: "time" },
  { key: "scanner", label: "Scanner", icon: "camera", iconActive: "camera" },
  { key: "favorites", label: "Favoris", icon: "star-outline", iconActive: "star" },
  { key: "profile", label: "Profil", icon: "person-outline", iconActive: "person" },
];

export interface BottomTabBarProps {
  active: RootTab;
  onSelect: (tab: RootTab) => void;
}

/**
 * Barre d'onglets consommateur (Phase 3, polish visuel Phase 22 du LOT
 * "visual product pass") — 5 onglets fixes, Scanner visuellement
 * prioritaire (bouton central surélevé, couleur primaire, ombre marquée).
 * Icônes réelles (`components/ui/Icon.tsx`, Ionicons déjà résolu par
 * `expo`) plutôt que des emoji (Phase 23 : "élimine les emoji UI produit").
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
              style={({ pressed }) => [styles.scannerButton, pressed && styles.scannerButtonPressed]}
              hitSlop={8}
            >
              <Icon name={tab.icon} size={26} color={colors.textOnPrimary} />
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
            style={({ pressed }) => [styles.tabButton, pressed && styles.tabButtonPressed]}
            hitSlop={8}
          >
            <Icon name={isActive ? tab.iconActive : tab.icon} size={22} color={isActive ? colors.primary : colors.textMuted} />
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
    borderTopColor: colors.borderSubtle,
  },
  tabButton: { alignItems: "center", gap: 3, minWidth: 56, minHeight: 48, justifyContent: "center" },
  tabButtonPressed: { opacity: 0.6 },
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
    ...shadows.raised,
  },
  scannerButtonPressed: { transform: [{ scale: 0.95 }] },
});
