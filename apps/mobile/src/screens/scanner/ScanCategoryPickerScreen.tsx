import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { CategorySlug } from "@dealradar/contracts";
import { Icon, type IconName } from "../../components/ui/Icon";
import { colors, radius, spacing, typography } from "../../theme/tokens";

/**
 * Porte de catégorie du Scanner (LOT "rendre le scan universel accessible
 * dans l'app") — premier écran vu en ouvrant l'onglet Scanner, avant toute
 * capture. Route explicite (ADR 0013 : "aucune reconnaissance automatique
 * de catégorie") — l'utilisateur choisit, jamais une catégorie devinée.
 * `pokemon_tcg` reste en premier (cas d'usage historique le plus fréquent),
 * mais reste UN choix explicite comme les autres : aucun raccourci qui
 * saute cette étape, pour qu'un choix accidentel de "Pokémon" par défaut ne
 * puisse jamais se produire (voir `ScannerEntryScreen.tsx`).
 */

export interface ScanCategoryOption {
  category: CategorySlug;
  label: string;
  icon: IconName;
}

export const SCAN_CATEGORY_OPTIONS: readonly ScanCategoryOption[] = [
  { category: "pokemon_tcg", label: "Pokémon / cartes", icon: "albums-outline" },
  { category: "apple", label: "Téléphones / Apple", icon: "phone-portrait-outline" },
  { category: "gaming", label: "Consoles / jeux", icon: "game-controller-outline" },
  { category: "sneakers", label: "Sneakers", icon: "footsteps-outline" },
  { category: "watches", label: "Montres", icon: "watch-outline" },
  { category: "lego", label: "LEGO", icon: "cube-outline" },
  { category: "photo", label: "Photo / appareils", icon: "camera-outline" },
  { category: "pc_components", label: "PC / composants", icon: "hardware-chip-outline" },
  { category: "collectibles", label: "Collection", icon: "star-outline" },
  { category: "general", label: "Autre", icon: "apps-outline" },
];

export interface ScanCategoryPickerScreenProps {
  onSelect: (category: CategorySlug) => void;
}

export function ScanCategoryPickerScreen({ onSelect }: ScanCategoryPickerScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Que veux-tu estimer ?</Text>
      <Text style={styles.subtitle}>Choisis une catégorie pour lancer le scan.</Text>
      <View style={styles.list}>
        {SCAN_CATEGORY_OPTIONS.map((option) => (
          <Pressable
            key={option.category}
            onPress={() => onSelect(option.category)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.iconWrap}>
              <Icon name={option.icon} size={22} color={colors.primary} />
            </View>
            <Text style={styles.rowLabel}>{option.label}</Text>
            <Icon name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { ...typography.bodyStrong, color: colors.textPrimary, flex: 1 },
});
