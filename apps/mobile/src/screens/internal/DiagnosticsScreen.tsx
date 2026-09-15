import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { getCurrentSession } from "../../auth/session";
import { INTERNAL_TOOLS_ENABLED } from "../../config/internal-tools";
import { checkBackendReachable, extractDomain } from "../../diagnostics/backend-health";
import { getLastAnalysis, getLastError } from "../../diagnostics/diagnostics-store";
import { countFavorites, countHistory } from "../../history/storage";
import { formatAnalysisDate } from "../../format/date";
import { colors, spacing, typography } from "../../theme/tokens";

export interface DiagnosticsScreenProps {
  onBack: () => void;
}

/**
 * Diagnostics internes (LOT "beta product readiness", Phase 33/34/35/36)
 * — un instantané lu à l'ouverture, jamais un flux temps réel (écran
 * interne consulté à la demande, voir `diagnostics/diagnostics-store.ts`).
 *
 * JAMAIS affiché ici : clé API, jeton, service role, secret complet
 * (Phase 33/42) — seulement le DOMAINE des URLs (`extractDomain`), jamais
 * le chemin ni une query string, et seulement "session présente OUI/NON"
 * pour l'authentification, jamais le jeton lui-même.
 */
export function DiagnosticsScreen({ onBack }: DiagnosticsScreenProps) {
  const [sessionPresent, setSessionPresent] = useState<string>("Vérification…");
  const [backendReachable, setBackendReachable] = useState<string>("Vérification…");
  const [historyCount, setHistoryCount] = useState<string>("…");
  const [favoritesCount, setFavoritesCount] = useState<string>("…");

  const refresh = useCallback(() => {
    setSessionPresent("Vérification…");
    setBackendReachable("Vérification…");
    setHistoryCount("…");
    setFavoritesCount("…");

    void getCurrentSession().then((session) => setSessionPresent(session ? "OUI" : "NON"));
    void checkBackendReachable().then((reachable) => setBackendReachable(reachable ? "OUI" : "NON"));
    void countHistory().then((n) => setHistoryCount(String(n)));
    void countFavorites().then((n) => setFavoritesCount(String(n)));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const apiBaseUrl = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? null;
  const supabaseUrl = (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ?? null;
  const lastAnalysis = getLastAnalysis();
  const lastError = getLastError();

  const rows: [string, string][] = [
    ["App version", Constants.expoConfig?.version ?? "—"],
    ["Build number", (Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? "—").toString()],
    ["Outils internes actifs", INTERNAL_TOOLS_ENABLED ? "OUI" : "NON"],
    ["Session présente", sessionPresent],
    ["Domaine API", apiBaseUrl ? extractDomain(apiBaseUrl) : "—"],
    ["Domaine Supabase", supabaseUrl ? extractDomain(supabaseUrl) : "—"],
    ["Backend joignable", backendReachable],
    ["Dernière analyse — statut", lastAnalysis?.status ?? "aucune"],
    ["Dernière analyse — durée", lastAnalysis ? `${lastAnalysis.durationMs} ms` : "—"],
    ["Dernière analyse — à", lastAnalysis ? formatAnalysisDate(lastAnalysis.timestamp) : "—"],
    ["Dernière erreur — code", lastError?.code ?? "aucune"],
    ["Dernière erreur — étape", lastError?.stage ?? "—"],
    ["Historique — nombre d'entrées", historyCount],
    ["Favoris — nombre d'entrées", favoritesCount],
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Diagnostics</Text>
      <Card style={styles.section}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </Card>
      <AppButton title="Rafraîchir" onPress={refresh} variant="secondary" />
      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary },
  section: { gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  label: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
  value: { ...typography.bodyStrong, color: colors.textPrimary },
});
