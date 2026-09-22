import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { ErrorState } from "../../components/errors/ErrorState";
import { ProductHistoryChart } from "../../components/result/ProductHistoryChart";
import { fetchProductHistory, ProductHistoryError } from "../../api/product-history-client";
import { toProductHistoryDetailViewModel, type ProductHistoryDetailViewModel } from "../../history/product-history-detail-view-model";
import { formatMoney, formatMoneyRange } from "../../format/money";
import { colors, spacing, typography } from "../../theme/tokens";

export interface ProductHistoryScreenProps {
  productKey: string;
  /** Nom/titre déjà connu (venant du résultat qui a mené ici) — cet écran n'en dérive jamais un lui-même. */
  productName: string | null;
  /** Position prix d'achat vs. historique DÉJÀ calculée par l'analyse d'origine (`ResultMarketInsight.currentVsHistoryLabel`) — jamais recalculée ici avec un prix différent, pour ne jamais afficher deux comparaisons "actuel vs historique" potentiellement contradictoires sur le même produit. */
  currentVsHistoryLabel?: string | null;
  onBack: () => void;
}

/**
 * Écran d'historique de prix PRODUIT GÉNÉRIQUE (LOT "Product History UX +
 * Source Health + Interactive Cancellation + Beta Readiness", section 1) —
 * réservé aux résultats NON-TCG (voir `MarketInsightCard`, qui est le seul
 * point d'entrée réel de navigation vers cet écran, jamais rendu pour un
 * résultat TCG puisque `marketInsight` y est toujours `null`). Lecture
 * SEULE, aucune prédiction de prix futur, aucune recommandation — reflète
 * fidèlement `ProductHistoryDetailViewModel`.
 *
 * États explicites (section 3) : chargement, erreur avec retry, vide
 * (historique réellement absent, jamais confondu avec une erreur réseau).
 */
export function ProductHistoryScreen({ productKey, productName, currentVsHistoryLabel, onBack }: ProductHistoryScreenProps) {
  const [state, setState] = useState<{ status: "loading" | "loaded" | "error"; data: ProductHistoryDetailViewModel | null; message: string | null }>({
    status: "loading",
    data: null,
    message: null,
  });

  const refresh = useCallback(() => {
    setState({ status: "loading", data: null, message: null });
    fetchProductHistory(productKey)
      .then((response) => setState({ status: "loaded", data: toProductHistoryDetailViewModel(response), message: null }))
      .catch((error: unknown) => {
        const message = error instanceof ProductHistoryError ? error.message : "Une erreur inattendue est survenue.";
        setState({ status: "error", data: null, message });
      });
  }, [productKey]);

  useEffect(() => refresh(), [refresh]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Historique de prix</Text>
      {productName && <Text style={styles.subtitle}>{productName}</Text>}

      {state.status === "loading" && (
        <Card style={styles.section}>
          <Text style={styles.value}>Chargement…</Text>
        </Card>
      )}

      {state.status === "error" && (
        <ErrorState source={{ kind: "message", raw: state.message ?? "Une erreur inattendue est survenue." }} onRetry={refresh} retryLabel="Réessayer" />
      )}

      {state.status === "loaded" && state.data && <ProductHistoryContent data={state.data} currentVsHistoryLabel={currentVsHistoryLabel ?? null} />}

      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

/**
 * `isEmpty` (aucun ÉCHANTILLON de PRIX historique) ne masque JAMAIS la carte
 * "Couverture" (trouvaille d'audit, section 8/12 du LOT "Product History
 * UX...") : un produit peut avoir des annonces actives suivies
 * (`activeSupplyCount > 0`) SANS le moindre point de prix historique — avant
 * ce correctif, cet écran affichait uniquement "Aucun historique de prix
 * disponible", cachant entièrement une information honnête et disponible
 * (le nombre d'annonces actives réellement suivies). Le graphique/la valeur
 * de référence/les tendances restent conditionnés à `isEmpty` (aucun sens
 * sans au moins un échantillon), mais "Annonces actives suivies"/"Sources
 * distinctes" sont des compteurs indépendants de `sampleSize`. La ligne
 * "Confiance de l'historique" reste masquée si `isEmpty` (0% avec zéro
 * échantillon n'apporte rien, jamais affiché comme si c'était une mesure
 * significative).
 */
function ProductHistoryContent({ data, currentVsHistoryLabel }: { data: ProductHistoryDetailViewModel; currentVsHistoryLabel: string | null }) {
  const currency = data.snapshotPoints[0]?.currency ?? null;

  return (
    <>
      {data.isEmpty ? (
        <Card style={styles.section}>
          <Text style={styles.value}>Aucun historique de prix disponible pour ce produit pour l'instant.</Text>
        </Card>
      ) : (
        <>
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Évolution récente</Text>
            <ProductHistoryChart points={data.snapshotPoints} />
          </Card>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Valeur de référence</Text>
            <Row label="Médiane historique" value={data.medianCents !== null && currency ? formatMoney(data.medianCents / 100, currency) : "—"} />
            <Row label="Fourchette" value={data.lowCents !== null && data.highCents !== null && currency ? formatMoneyRange(data.lowCents / 100, data.highCents / 100, currency) : "—"} />
            {currentVsHistoryLabel && <Text style={styles.hint}>{currentVsHistoryLabel}</Text>}
          </Card>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Tendances</Text>
            {data.trends.map((t) => (
              <Row key={t.windowDays} label={`${t.windowDays} j`} value={t.label} />
            ))}
            <Text style={styles.hint}>Décrit un comportement déjà observé — jamais une prévision de prix futur.</Text>
          </Card>
        </>
      )}

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Couverture</Text>
        <Row label="Annonces actives suivies" value={String(data.activeSupplyCount)} />
        <Row label="Sources distinctes" value={String(data.sourceDiversity)} />
        {!data.isEmpty && <Row label="Confiance de l'historique" value={`${Math.round(data.confidence)}%`} />}
        {!data.isEmpty && data.confidence < 40 && <Text style={styles.hint}>Historique clairsemé — cette confiance reste volontairement basse, jamais surestimée.</Text>}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: -spacing.sm },
  section: { gap: spacing.xs },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, marginBottom: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  label: { ...typography.body, color: colors.textSecondary },
  value: { ...typography.bodyStrong, color: colors.textPrimary },
  hint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
});
