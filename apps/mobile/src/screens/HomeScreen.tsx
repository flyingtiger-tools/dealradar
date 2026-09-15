import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RafAvatar } from "../components/raf/RafAvatar";
import { RadarPulse } from "../components/ui/RadarPulse";
import { AppButton } from "../components/ui/AppButton";
import { HistoryEntryRow } from "../components/history/HistoryEntryRow";
import { listHistory, toggleHistoryFavorite, removeHistoryEntry } from "../history/storage";
import type { HistoryEntry } from "../history/types";
import { colors, spacing, typography } from "../theme/tokens";

export interface HomeScreenProps {
  onOpenScanner: () => void;
  /** Ouvre l'onglet Historique — utilisé par la section "Dernières analyses" ci-dessous (Phase 4/17, LOT "visual product pass" : de vraies données plutôt que des sections vides fixes). */
  onOpenHistory: () => void;
}

const RECENT_COUNT = 3;

/**
 * Vraie home (Phase 4, LOT "visual product pass") — hiérarchie : marque ->
 * eyebrow "KNOW WHEN." -> hero abstrait (`RadarPulse`, sans Raf, Phase 5)
 * -> promesse -> CTA principal -> CTA secondaire -> dernières analyses
 * RÉELLES (`history/storage.ts`, maintenant que ce dépôt existe — LOT
 * "beta product readiness"). Les anciennes sections "Produits suivis" /
 * "Alertes" ont été retirées plutôt que laissées vides pour toujours :
 * aucune fonctionnalité de suivi de produit ni d'alerte n'existe dans
 * cette app (jamais promettre une activité qui n'existera jamais, Phase 4
 * : "ne pas inventer d'activité").
 */
export function HomeScreen({ onOpenScanner, onOpenHistory }: HomeScreenProps) {
  const [recent, setRecent] = useState<HistoryEntry[] | null>(null);

  const refresh = () => {
    void listHistory().then((all) => setRecent(all.slice(0, RECENT_COUNT)));
  };

  useEffect(refresh, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>DealRadar</Text>
        <RafAvatar state="neutral" size={32} />
      </View>

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>KNOW WHEN.</Text>
        <RadarPulse size={190} />
        <Text style={styles.promise}>Scanne un produit.</Text>
        <Text style={styles.subpromise}>Raf analyse le marché.</Text>
      </View>

      <View style={styles.ctas}>
        <AppButton title="Scanner maintenant" onPress={onOpenScanner} icon="camera" />
        <AppButton title="Importer une photo" onPress={onOpenScanner} variant="secondary" icon="images-outline" />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Dernières analyses</Text>
          {recent && recent.length > 0 && <Text style={styles.sectionLink} onPress={onOpenHistory}>Tout voir</Text>}
        </View>
        {recent === null ? null : recent.length === 0 ? (
          <Text style={styles.sectionEmpty}>Aucune analyse pour l'instant — scanne ta première carte.</Text>
        ) : (
          <View style={styles.recentList}>
            {recent.map((entry) => (
              <HistoryEntryRow
                key={entry.id}
                entry={entry}
                onPress={onOpenHistory}
                onToggleFavorite={() => void toggleHistoryFavorite(entry.id).then(refresh)}
                onDelete={() => void removeHistoryEntry(entry.id).then(refresh)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.xl, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { ...typography.title, color: colors.textPrimary },
  hero: { alignItems: "center", paddingVertical: spacing.md, gap: spacing.xs },
  eyebrow: { ...typography.eyebrow, color: colors.primary },
  promise: { ...typography.hero, color: colors.textPrimary, textAlign: "center", marginTop: spacing.sm },
  subpromise: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  ctas: { gap: spacing.sm },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  sectionLink: { ...typography.captionStrong, color: colors.primary },
  sectionEmpty: { ...typography.body, color: colors.textSecondary },
  recentList: { gap: spacing.sm },
});
