import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Share, StyleSheet, Text, View } from "react-native";
import type { ResultViewModel } from "./result-view-model";
import { deriveHeroPriceRange } from "./price-hero";
import { RafResultHero } from "../../components/raf/RafResultHero";
import { ErrorState } from "../../components/errors/ErrorState";
import { PriceHero } from "../../components/result/PriceHero";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { VerdictBanner } from "../../components/ui/VerdictBanner";
import { ScoreConfidenceRow } from "../../components/ui/ScoreConfidenceRow";
import { WhyPanel } from "../../components/ui/WhyPanel";
import { getDealTierFromDecision, getRafStateForDealTier, getRafStateForIdentificationStatus } from "../../theme/raf-mapping";
import { borderWidth, colors, spacing, typography } from "../../theme/tokens";
import { formatMoney } from "../../format/money";
import { formatAnalysisDate } from "../../format/date";
import { formatSourceLabel, formatProvenanceLabel } from "../../format/source-display";
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
 * Écran central DealRadar (Phase 10, LOT "visual product pass" : "l'écran
 * qui reçoit le plus de travail"). Hiérarchie de lecture en < 2 secondes :
 * verdict (quand il existe réellement) -> identité -> PRIX (élément le
 * plus visible, `PriceHero`, Phase 11) -> score/confiance -> pourquoi ->
 * sources discrètes -> actions (favori/partager secondaires, "Nouveau
 * scan" dominant). Reçoit un `ResultViewModel` déjà normalisé — jamais un
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

  // Entrée douce (Phase 28/29 : "prévenir un changement brusque" — cet
  // écran remplace toujours un écran de chargement, jamais une
  // décoration gratuite sur un contenu déjà affiché). Occasionnel (un
  // résultat par scan), largement sous les 300ms recommandés pour une UI.
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [view, entrance]);
  const entranceStyle = { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] };

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
      marketValue: deriveHeroPriceRange(view),
    });
    try {
      await Share.share({ message: text });
    } catch {
      // `Share.share` peut rejeter si l'utilisateur annule le sheet natif — jamais une erreur affichée pour ça.
    }
  };

  if (view.identityStatus !== "identified") {
    return (
      <Animated.ScrollView contentContainerStyle={styles.container} style={entranceStyle}>
        {view.isDemo && <Badge label="DEMO" tone="warning" />}
        <ErrorState
          source={{ kind: "message", raw: view.reasonMessage ?? "Identification impossible avec les informations disponibles." }}
          onRetry={onScanAnother}
          retryLabel="Nouveau scan"
        />
      </Animated.ScrollView>
    );
  }

  const rafState = view.decision ? getRafStateForDealTier(getDealTierFromDecision(view.decision, view.dealScore)) : getRafStateForIdentificationStatus("identified");
  const heroRange = deriveHeroPriceRange(view);
  const distinctSources = Array.from(new Set(view.prices.map((p) => formatProvenanceLabel(p.source) ?? formatSourceLabel(p.source) ?? p.source)));

  return (
    <Animated.ScrollView contentContainerStyle={styles.container} style={entranceStyle}>
      {view.isDemo && <Badge label="DEMO — donnée fictive" tone="warning" />}

      {view.decision && <VerdictBanner decision={view.decision} />}

      <RafResultHero
        state={rafState}
        headline={view.product.name ?? "Produit identifié"}
        subheadline={[view.product.setName, view.product.collectorNumber ? `#${view.product.collectorNumber}` : null].filter(Boolean).join(" · ") || undefined}
      />

      <Card variant="raised" style={styles.priceCard}>
        <PriceHero range={heroRange} />
        {distinctSources.length > 0 && <Text style={styles.sources}>Sources : {distinctSources.join(" · ")}</Text>}
      </Card>

      <Card style={styles.section}>
        <ScoreConfidenceRow score={view.dealScore} confidencePercent={view.confidencePercent} />
      </Card>

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

      {view.hasPricing && (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Prix par source</Text>
          {view.prices.map((row, i) => (
            <View key={i} style={styles.priceRow}>
              <Text style={styles.priceSource}>
                {formatProvenanceLabel(row.source) ?? formatSourceLabel(row.source) ?? row.source}
                {row.condition ? ` · ${row.condition}` : ""}
              </Text>
              <Text style={styles.priceAmount}>{formatMoney(row.amountCents / 100, row.currency)}</Text>
              {row.convertedAmountCents !== null && row.convertedCurrency && (
                <Text style={styles.priceConverted}>≈ {formatMoney(row.convertedAmountCents / 100, row.convertedCurrency)} (indicatif)</Text>
              )}
              {row.updatedAt && <Text style={styles.priceTimestamp}>Mis à jour : {formatAnalysisDate(row.updatedAt)}</Text>}
            </View>
          ))}
        </Card>
      )}
      {!view.hasPricing && <ErrorState source={{ kind: "code", code: "NO_PRICE" }} />}

      <WhyPanel positives={view.reasons} warnings={view.warnings} />

      <View style={styles.secondaryActions}>
        {historyEntryId && (
          <IconTextButton icon={favorite ? "heart" : "heart-outline"} label={favorite ? "Favori" : "Ajouter"} tone={favorite ? colors.danger : colors.textSecondary} onPress={() => void toggleFavorite()} />
        )}
        <IconTextButton icon="share-outline" label="Partager" tone={colors.textSecondary} onPress={() => void shareResult()} />
      </View>
      <AppButton title="Nouveau scan" onPress={onScanAnother} icon="camera" />
      {onExit && <AppButton title="Fermer" onPress={onExit} variant="ghost" />}
    </Animated.ScrollView>
  );
}

function IconTextButton({ icon, label, tone, onPress }: { icon: "heart" | "heart-outline" | "share-outline"; label: string; tone: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.iconTextButton, pressed && styles.iconTextButtonPressed]}>
      <Icon name={icon} size={18} color={tone} />
      <Text style={[styles.iconTextButtonLabel, { color: tone }]}>{label}</Text>
    </Pressable>
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
  priceCard: { alignItems: "center", gap: spacing.sm },
  sources: { ...typography.caption, color: colors.textMuted, textAlign: "center" },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, marginBottom: spacing.xs },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  infoLabel: { ...typography.body, color: colors.textSecondary },
  infoValue: { ...typography.bodyStrong, color: colors.textPrimary },
  priceRow: { paddingVertical: spacing.sm, borderBottomWidth: borderWidth.hairline, borderBottomColor: colors.borderSubtle, gap: 2 },
  priceSource: { ...typography.captionStrong, color: colors.textSecondary },
  priceAmount: { ...typography.subtitle, color: colors.textPrimary },
  priceConverted: { ...typography.caption, color: colors.textMuted },
  priceTimestamp: { ...typography.caption, color: colors.textMuted },
  secondaryActions: { flexDirection: "row", gap: spacing.lg, justifyContent: "center", marginTop: spacing.sm },
  iconTextButton: { flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: spacing.sm },
  iconTextButtonPressed: { opacity: 0.6 },
  iconTextButtonLabel: { ...typography.bodyStrong },
});
