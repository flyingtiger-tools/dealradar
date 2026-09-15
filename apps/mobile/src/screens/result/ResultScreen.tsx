import { useEffect, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
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
import { formatMoney } from "../../format/money";
import { formatAnalysisDate } from "../../format/date";
import { formatSourceLabel } from "../../format/source-display";
import { buildResultShareText } from "../../format/share";
import { toggleHistoryFavorite } from "../../history/storage";

export interface ResultScreenProps {
  view: ResultViewModel;
  onScanAnother: () => void;
  onExit?: () => void;
  /**
   * Id de l'entrée d'historique correspondante (Phase 20) — `null` tant
   * qu'aucune entrée n'a été sauvegardée (résultat non identifié, ou
   * sauvegarde encore en cours juste après un scan — voir
   * `TcgScanScreen.tsx`). Le bouton favori ne s'affiche que si cet id est
   * disponible : il n'existe rien à basculer sinon.
   */
  historyEntryId?: string | null;
  initialFavorite?: boolean;
}

/**
 * Écran central DealRadar (Phase 8) — identité, prix par source, score/
 * confiance (Phase 9), verdict (Phase 8/10), panneau "Pourquoi ?"
 * (Phase 11), favori + partage (Phase 20/24, LOT "beta product
 * readiness"). Reçoit un `ResultViewModel` déjà normalisé — jamais un
 * contrat réseau brut (voir `result-view-model.ts`) — donc utilisable tel
 * quel par un vrai scan, par le détail d'historique
 * (`history/to-result-view-model.ts`) ET par les fixtures DEMO.
 */
export function ResultScreen({ view, onScanAnother, onExit, historyEntryId = null, initialFavorite = false }: ResultScreenProps) {
  const [favorite, setFavorite] = useState(initialFavorite);
  // Se resynchronise si l'appelant change d'id (ex. le favori devient
  // disponible juste après un scan une fois la sauvegarde en historique
  // terminée) — jamais un état local qui divergerait silencieusement de
  // la source de vérité (`history/storage.ts`).
  useEffect(() => setFavorite(initialFavorite), [historyEntryId, initialFavorite]);

  const toggleFavorite = async () => {
    if (!historyEntryId) return;
    try {
      const updated = await toggleHistoryFavorite(historyEntryId);
      setFavorite(updated.favorite);
    } catch {
      // Best-effort — jamais un écran cassé pour un favori qui n'a pas pu être basculé.
    }
  };

  const shareResult = async () => {
    const text = buildResultShareText({
      productName: view.product.name,
      setName: view.product.setName,
      collectorNumber: view.product.collectorNumber,
      marketValue: chfRange(view),
    });
    try {
      await Share.share({ message: text });
    } catch {
      // `Share.share` peut rejeter si l'utilisateur annule le sheet natif — jamais une erreur affichée pour ça.
    }
  };

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
                {formatSourceLabel(row.source) ?? row.source}
                {row.condition ? ` · ${row.condition}` : ""}
              </Text>
              <Text style={styles.priceAmount}>{formatMoney(row.amountCents / 100, row.currency)}</Text>
              {row.convertedAmountCents !== null && row.convertedCurrency && (
                <Text style={styles.priceConverted}>≈ {formatMoney(row.convertedAmountCents / 100, row.convertedCurrency)} (indicatif)</Text>
              )}
              {row.updatedAt && <Text style={styles.priceTimestamp}>Mis à jour : {formatAnalysisDate(row.updatedAt)}</Text>}
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
        {historyEntryId && <AppButton title={favorite ? "♥ Retirer des favoris" : "♡ Ajouter aux favoris"} onPress={() => void toggleFavorite()} variant="secondary" />}
        <AppButton title="Partager" onPress={() => void shareResult()} variant="secondary" />
        <AppButton title="Nouveau scan" onPress={onScanAnother} />
        {onExit && <AppButton title="Fermer" onPress={onExit} variant="ghost" />}
      </View>
    </ScrollView>
  );
}

/** Même règle de dérivation que `history/from-result-view-model.ts` — jamais une seconde formule qui pourrait diverger (montant natif CHF ou converti uniquement, jamais une moyenne). */
function chfRange(view: ResultViewModel): { low: number; high: number; currency: string } | null {
  const amounts = view.prices.map((p) => p.convertedAmountCents ?? (p.currency === "CHF" ? p.amountCents : null)).filter((v): v is number => v !== null);
  if (amounts.length === 0) return null;
  return { low: Math.min(...amounts) / 100, high: Math.max(...amounts) / 100, currency: "CHF" };
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

