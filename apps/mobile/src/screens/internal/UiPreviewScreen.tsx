import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RafAvatar } from "../../components/raf/RafAvatar";
import { RafIllustration } from "../../components/raf/RafIllustration";
import { RafEmptyState } from "../../components/raf/RafEmptyState";
import { AppButton } from "../../components/ui/AppButton";
import { Badge } from "../../components/ui/Badge";
import { VerdictBanner } from "../../components/ui/VerdictBanner";
import { ScoreConfidenceRow } from "../../components/ui/ScoreConfidenceRow";
import { ErrorState } from "../../components/errors/ErrorState";
import { ResultScreen } from "../result/ResultScreen";
import { DEMO_RESULT_FIXTURES } from "../../fixtures/demo-results";
import { ALL_RAF_STATES } from "../../theme/raf-mapping";
import { getRafAsset } from "../../assets/raf/registry";
import { borderWidth, colors, radius, spacing, typography } from "../../theme/tokens";

export interface UiPreviewScreenProps {
  onBack: () => void;
}

/**
 * UI Preview (Phase 15) — développer/vérifier les composants sans backend.
 * Interne uniquement (`INTERNAL_TOOLS_ENABLED`, garde déjà faite par
 * `InternalToolsScreen`). Seul consommateur autorisé de
 * `fixtures/demo-results.ts` (voir isolation, Phase 30).
 */
export function UiPreviewScreen({ onBack }: UiPreviewScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>UI Preview</Text>
        <Badge label="INTERNE" tone="warning" />
      </View>

      <Section title="Raf — tous les états">
        <View style={styles.wrapRow}>
          {ALL_RAF_STATES.map((state) => {
            const asset = getRafAsset(state);
            return (
              <View key={state} style={styles.rafCell}>
                <RafAvatar state={state} size={48} />
                <Text style={styles.rafLabel}>{state}</Text>
                <Badge label={asset.kind === "image" ? "PRODUCTION" : "FALLBACK"} tone={asset.kind === "image" ? "success" : "neutral"} />
              </View>
            );
          })}
        </View>
      </Section>

      <Section title="Raf — illustration (pulse)">
        <RafIllustration state="analyzing" size={120} pulse />
      </Section>

      <Section title="Boutons">
        <View style={styles.stack}>
          <AppButton title="Primary" onPress={() => undefined} variant="primary" />
          <AppButton title="Secondary" onPress={() => undefined} variant="secondary" />
          <AppButton title="Ghost" onPress={() => undefined} variant="ghost" />
          <AppButton title="Danger" onPress={() => undefined} variant="danger" />
          <AppButton title="Disabled" onPress={() => undefined} disabled />
        </View>
      </Section>

      <Section title="Verdict">
        <View style={styles.stack}>
          <VerdictBanner decision="BUY" />
          <VerdictBanner decision="REVIEW" />
          <VerdictBanner decision="PASS" />
          <VerdictBanner decision="INSUFFICIENT_DATA" />
        </View>
      </Section>

      <Section title="Score / Confiance">
        <ScoreConfidenceRow score={78} confidencePercent={91} />
      </Section>

      <Section title="Empty states">
        <RafEmptyState state="neutral" title="Aucune analyse pour l'instant" subtitle="Raf attend sa première mission." />
      </Section>

      <Section title="Erreurs">
        <View style={styles.stack}>
          <ErrorState source={{ kind: "code", code: "NETWORK_UNAVAILABLE" }} />
          <ErrorState source={{ kind: "code", code: "NO_PRICE" }} />
        </View>
      </Section>

      <Section title="Résultats DEMO">
        {DEMO_RESULT_FIXTURES.map(({ key, label, view }) => (
          <View key={key} style={styles.demoBlock}>
            <Text style={styles.demoLabel}>{label}</Text>
            <View style={styles.demoResultBox}>
              <ResultScreen view={view} onScanAnother={() => undefined} />
            </View>
          </View>
        ))}
      </Section>

      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.xl, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  rafCell: { alignItems: "center", gap: spacing.xs, width: 96 },
  rafLabel: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
  stack: { gap: spacing.sm },
  demoBlock: { gap: spacing.xs },
  demoLabel: { ...typography.captionStrong, color: colors.textSecondary },
  demoResultBox: { borderWidth: borderWidth.thin, borderColor: colors.border, borderRadius: radius.lg, overflow: "hidden" },
});
