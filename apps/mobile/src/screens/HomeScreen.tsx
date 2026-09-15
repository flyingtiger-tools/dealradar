import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RafAvatar } from "../components/raf/RafAvatar";
import { Card } from "../components/ui/Card";
import { AppButton } from "../components/ui/AppButton";
import { colors, spacing, typography } from "../theme/tokens";

export interface HomeScreenProps {
  onOpenScanner: () => void;
}

/**
 * Vraie home (Phase 6, LOT "package V3") — hiérarchie : marque -> Raf
 * discret -> promesse -> CTA principal -> CTA secondaire -> contenu
 * secondaire. Aucune section n'affiche de donnée fabriquée : "Dernières
 * analyses"/"Produits suivis"/"Alertes" restent en état vide tant
 * qu'aucun backend d'historique/favoris/alertes n'existe (voir Phases
 * 12/13, docs/mobile/ui-product-foundation.md).
 */
export function HomeScreen({ onOpenScanner }: HomeScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>DealRadar</Text>
        <RafAvatar state="neutral" size={32} />
      </View>

      <View style={styles.hero}>
        <Text style={styles.promise}>Trouve le bon moment.</Text>
        <Text style={styles.subpromise}>Scanne un produit et vois ce que le marché en pense.</Text>
      </View>

      <View style={styles.ctas}>
        <AppButton title="Scanner un produit" onPress={onOpenScanner} />
        <AppButton title="Importer une photo" onPress={onOpenScanner} variant="secondary" />
      </View>

      <EmptySection title="Dernières analyses" empty="Aucune analyse pour l'instant." />
      <EmptySection title="Produits suivis" empty="Aucun produit suivi pour l'instant." />
      <EmptySection title="Alertes" empty="Aucune alerte pour l'instant." />
    </ScrollView>
  );
}

function EmptySection({ title, empty }: { title: string; empty: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Card>
        <Text style={styles.sectionEmpty}>{empty}</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { ...typography.title, color: colors.textPrimary },
  hero: { paddingVertical: spacing.md, gap: spacing.xs },
  promise: { ...typography.display, color: colors.textPrimary },
  subpromise: { ...typography.body, color: colors.textSecondary },
  ctas: { gap: spacing.sm },
  section: { gap: spacing.xs },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  sectionEmpty: { ...typography.body, color: colors.textSecondary },
});
