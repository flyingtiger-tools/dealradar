import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { ResultViewModel } from "./result-view-model";
import { RafResultHero } from "../../components/raf/RafResultHero";
import { ErrorState } from "../../components/errors/ErrorState";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { Badge } from "../../components/ui/Badge";
import { VerdictBanner } from "../../components/ui/VerdictBanner";
import { ScoreConfidenceRow } from "../../components/ui/ScoreConfidenceRow";
import { WhyPanel } from "../../components/ui/WhyPanel";
import { getDealTierFromDecision, getRafStateForDealTier, getRafStateForIdentificationStatus } from "../../theme/raf-mapping";
import { borderWidth, colors, spacing, typography } from "../../theme/tokens";

export interface ResultScreenProps {
  view: ResultViewModel;
  onScanAnother: () => void;
  onExit?: () => void;
}

/**
 * Écran central DealRadar (Phase 8) — identité, prix par source, score/
 * confiance (Phase 9), verdict (Phase 8/10), panneau "Pourquoi ?"
 * (Phase 11). Reçoit un `ResultViewModel` déjà normalisé — jamais un
 * contrat réseau brut (voir `result-view-model.ts`) — donc utilisable tel
 * quel par un vrai scan ET par les fixtures DEMO (Phase 16).
 */
export function ResultScreen({ view, onScanAnother, onExit }: ResultScreenProps) {
  if (view.identityStatus !== "identified") {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        {view.isDemo && <Badge label="DEMO" tone="warning" />}
        <ErrorState
          source={{ kind: "message", raw: view.reasonMessage ?? "Identification impossible avec les informations disponibles." }}
          onRetry={onScanAnother}
          retryLabel="Nouveau scan"
        />
      </ScrollView>
    );
  }

  const rafState = view.decision ? getRafStateForDealTier(getDealTierFromDecision(view.decision, view.dealScore)) : getRafStateForIdentificationStatus("identified");

  // Hiérarchie de lecture (Phase 13) : verdict d'abord (quand il existe
  // réellement), puis l'état Raf/identité, puis prix, puis confiance,
  // informations détaillées, "pourquoi", actions — jamais 18 blocs
  // d'égale importance en même temps.
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {view.isDemo && <Badge label="DEMO — donnée fictive" tone="warning" />}

      {view.decision && <VerdictBanner decision={view.decision} />}

      <RafResultHero
        state={rafState}
        headline={view.product.name ?? "Produit identifié"}
        subheadline={[view.product.setName, view.product.collectorNumber ? `#${view.product.collectorNumber}` : null].filter(Boolean).join(" · ") || undefined}
      />

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Identité</Text>
        <InfoRow label="Nom" value={view.product.name} />
        <InfoRow label="Set" value={view.product.setName} />
        <InfoRow label="Numéro" value={view.product.collectorNumber} />
        <InfoRow label="Langue" value={view.product.language} />
        <InfoRow label="Variante" value={view.product.variant} />
        {view.product.productKind === "graded_card" && (
          <InfoRow label="Gradation" value={[view.product.gradingCompany, view.product.grade].filter(Boolean).join(" ") || null} />
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Prix par source</Text>
        {view.hasPricing ? (
          view.prices.map((row, i) => (
            <View key={i} style={styles.priceRow}>
              <Text style={styles.priceSource}>
                {row.source}
                {row.condition ? ` · ${row.condition}` : ""}
              </Text>
              <Text style={styles.priceAmount}>
                {(row.amountCents / 100).toFixed(2)} {row.currency}
              </Text>
              {row.convertedAmountCents !== null && row.convertedCurrency && (
                <Text style={styles.priceConverted}>
                  ≈ {(row.convertedAmountCents / 100).toFixed(2)} {row.convertedCurrency} (indicatif)
                </Text>
              )}
              {row.updatedAt && <Text style={styles.priceTimestamp}>Mis à jour : {new Date(row.updatedAt).toLocaleDateString()}</Text>}
            </View>
          ))
        ) : (
          <ErrorState source={{ kind: "code", code: "NO_PRICE" }} />
        )}
      </Card>

      <Card style={styles.section}>
        <ScoreConfidenceRow score={view.dealScore} confidencePercent={view.confidencePercent} />
      </Card>

      <WhyPanel positives={view.reasons} warnings={view.warnings} />

      <View style={styles.actions}>
        <AppButton title="Nouveau scan" onPress={onScanAnother} />
        {onExit && <AppButton title="Fermer" onPress={onExit} variant="ghost" />}
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value ?? "—"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  section: { gap: spacing.xs },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, marginBottom: spacing.xs },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  infoLabel: { ...typography.body, color: colors.textSecondary },
  infoValue: { ...typography.bodyStrong, color: colors.textPrimary },
  priceRow: { paddingVertical: spacing.sm, borderBottomWidth: borderWidth.hairline, borderBottomColor: colors.border, gap: 2 },
  priceSource: { ...typography.captionStrong, color: colors.textSecondary },
  priceAmount: { ...typography.subtitle, color: colors.textPrimary },
  priceConverted: { ...typography.caption, color: colors.textMuted },
  priceTimestamp: { ...typography.caption, color: colors.textMuted },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
