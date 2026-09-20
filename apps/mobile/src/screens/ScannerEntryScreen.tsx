import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CategorySlug } from "@dealradar/contracts";
import { ScanCategoryPickerScreen } from "./scanner/ScanCategoryPickerScreen";
import { TcgScanScreen } from "./TcgScanScreen";
import { UniversalScanScreen } from "./UniversalScanScreen";
import { resolveScannerBody } from "./scanner-routing";
import { Icon } from "../components/ui/Icon";
import { colors, spacing, typography } from "../theme/tokens";

/**
 * Point d'entrée réel de l'onglet Scanner (LOT "rendre le scan universel
 * accessible dans l'app") — remplace le montage direct de `TcgScanScreen`
 * dans `RootNavigator.tsx`. Fait de l'app un vrai scanner multi-catégories
 * depuis l'interface, pas seulement depuis un backend universel caché.
 *
 * Routage strict (ADR 0013, jamais de fallback silencieux vers Pokémon) :
 * - `pokemon_tcg` -> `TcgScanScreen` INCHANGÉ (le pipeline
 *   sync/async qu'il appelle directement est identique à celui de
 *   `tcgAdapter.analyze()` — même fonctions, même garde
 *   `INTERNAL_TOOLS_ENABLED`, voir `identification/tcg-adapter.ts` — mais
 *   `TcgScanScreen` reste la voie choisie ici pour ne PAS perdre le détail
 *   "prix par source" que `mapTcgResultToViewModel` produit et que le
 *   contrat aplati `RafAnalysis` ne porte pas).
 * - toute autre catégorie -> `UniversalScanScreen`, qui utilise
 *   `identifyCapture()` + `genericObjectAdapters` exclusivement (jamais
 *   `tcgAdapter` dans cette branche).
 *
 * Le sélecteur de catégorie est la première chose vue en ouvrant l'onglet
 * Scanner (aucun choix présélectionné) — un lien "Changer de catégorie"
 * reste visible au-dessus de l'écran actif pour revenir au sélecteur sans
 * quitter l'onglet.
 */
export function ScannerEntryScreen() {
  const [category, setCategory] = useState<CategorySlug | null>(null);
  const body = resolveScannerBody(category);

  if (body === "picker") {
    return <ScanCategoryPickerScreen onSelect={setCategory} />;
  }

  return (
    <View style={styles.root}>
      <Pressable onPress={() => setCategory(null)} accessibilityRole="button" accessibilityLabel="Changer de catégorie" style={styles.changeCategory}>
        <Icon name="chevron-back" size={16} color={colors.textSecondary} />
        <Text style={styles.changeCategoryLabel}>Changer de catégorie</Text>
      </Pressable>
      <View style={styles.body}>
        {body === "pokemon_tcg" ? (
          <TcgScanScreen />
        ) : (
          // `body === "universal"` implique `category !== null && category !== "pokemon_tcg"` (voir `resolveScannerBody`) —
          // TypeScript ne peut pas le déduire depuis un type dérivé, cast localisé plutôt qu'une garde dupliquée ici.
          <UniversalScanScreen category={category as Exclude<CategorySlug, "pokemon_tcg">} onExit={() => setCategory(null)} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  changeCategory: { flexDirection: "row", alignItems: "center", gap: 4, padding: spacing.sm, paddingHorizontal: spacing.lg },
  changeCategoryLabel: { ...typography.caption, color: colors.textSecondary },
  body: { flex: 1 },
});
