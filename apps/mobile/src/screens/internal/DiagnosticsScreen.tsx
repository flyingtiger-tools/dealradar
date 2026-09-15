import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { StatusDot, type StatusTone } from "../../components/ui/StatusDot";
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

type RowValue = string | { text: string; tone: StatusTone } | { text: string; mono: true };

/**
 * Diagnostics internes (LOT "beta product readiness", Phase 33/34/35/36 —
 * polish visuel LOT "visual product pass", Phase 21 : "reste technique
 * mais propre, status rows, dot vert/jaune/rouge, monospace seulement où
 * pertinent") — un instantané lu à l'ouverture, jamais un flux temps réel
 * (écran interne consulté à la demande, voir
 * `diagnostics/diagnostics-store.ts`).
 *
 * JAMAIS affiché ici : clé API, jeton, service role, secret complet
 * (Phase 33/42) — seulement le DOMAINE des URLs (`extractDomain`), jamais
 * le chemin ni une query string, et seulement "session présente OUI/NON"
 * pour l'authentification, jamais le jeton lui-même. Chaque point coloré
 * reste accompagné d'un libellé texte (jamais une info uniquement par
 * couleur, Phase 31 accessibilité).
 */
export function DiagnosticsScreen({ onBack }: DiagnosticsScreenProps) {
  const [sessionPresent, setSessionPresent] = useState<boolean | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [historyCount, setHistoryCount] = useState<string>("…");
  const [favoritesCount, setFavoritesCount] = useState<string>("…");

  const refresh = useCallback(() => {
    setSessionPresent(null);
    setBackendReachable(null);
    setHistoryCount("…");
    setFavoritesCount("…");

    void getCurrentSession().then((session) => setSessionPresent(Boolean(session)));
    void checkBackendReachable().then(setBackendReachable);
    void countHistory().then((n) => setHistoryCount(String(n)));
    void countFavorites().then((n) => setFavoritesCount(String(n)));
  }, []);

  useEffect(() => refresh(), [refresh]);

  const apiBaseUrl = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? null;
  const supabaseUrl = (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ?? null;
  const lastAnalysis = getLastAnalysis();
  const lastError = getLastError();

  const boolRow = (value: boolean | null): RowValue => (value === null ? "Vérification…" : { text: value ? "OUI" : "NON", tone: value ? "success" : "danger" });

  const rows: [string, RowValue][] = [
    ["App version", Constants.expoConfig?.version ?? "—"],
    ["Build number", (Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? "—").toString()],
    ["Outils internes actifs", { text: INTERNAL_TOOLS_ENABLED ? "OUI" : "NON", tone: INTERNAL_TOOLS_ENABLED ? "warning" : "neutral" }],
    ["Session présente", boolRow(sessionPresent)],
    ["Domaine API", { text: apiBaseUrl ? extractDomain(apiBaseUrl) : "—", mono: true }],
    ["Domaine Supabase", { text: supabaseUrl ? extractDomain(supabaseUrl) : "—", mono: true }],
    ["Backend joignable", boolRow(backendReachable)],
    ["Dernière analyse — statut", lastAnalysis?.status ?? "aucune"],
    ["Dernière analyse — durée", lastAnalysis ? `${lastAnalysis.durationMs} ms` : "—"],
    ["Dernière analyse — à", lastAnalysis ? formatAnalysisDate(lastAnalysis.timestamp) : "—"],
    ["Dernière erreur — code", { text: lastError?.code ?? "aucune", mono: true }],
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
            <RowValueView value={value} />
          </View>
        ))}
      </Card>
      <AppButton title="Rafraîchir" onPress={refresh} variant="secondary" icon="refresh" />
      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

function RowValueView({ value }: { value: RowValue }) {
  if (typeof value === "string") return <Text style={styles.value}>{value}</Text>;
  if ("tone" in value) {
    return (
      <View style={styles.statusValue}>
        <StatusDot tone={value.tone} />
        <Text style={styles.value}>{value.text}</Text>
      </View>
    );
  }
  return <Text style={[styles.value, styles.mono]}>{value.text}</Text>;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary },
  section: { gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  label: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
  // `flexShrink: 1` ici aussi (LOT "device QA + first real scan", trouvé
  // sur device réel) — sans lui, Yoga refuse par défaut de rétrécir cet
  // élément (flexShrink vaut 0 si omis) et fait porter TOUT le manque de
  // place sur `label`, qui finit par se retrouver compressé au point de
  // couper "Domaine Supabase" lettre par lettre ("Dom"/"aine"/"Supa"/
  // "base") dès qu'une valeur (le domaine Vercel/Supabase) est longue.
  // `textAlign: "right"` aligne proprement une valeur qui se met sur
  // plusieurs lignes.
  value: { ...typography.bodyStrong, color: colors.textPrimary, flexShrink: 1, textAlign: "right" },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontWeight: "400" },
  statusValue: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
