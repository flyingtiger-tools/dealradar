import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../../components/ui/Card";
import { AppButton } from "../../components/ui/AppButton";
import { StatusDot, type StatusTone } from "../../components/ui/StatusDot";
import { fetchOperatorObservability, OperatorObservabilityError, type OperatorObservabilityResponse } from "../../api/operator-observability-client";
import { colors, spacing, typography } from "../../theme/tokens";

export interface OperatorDiagnosticsScreenProps {
  onBack: () => void;
}

/**
 * Diagnostics OPÉRATEUR (LOT "Interactive History + Generic Result UI +
 * Full Cancellation + Pre-Prod Activation Package", section 4) — distinct
 * de `DiagnosticsScreen.tsx` (santé de CE téléphone/session : app version,
 * session présente, backend joignable) : cet écran montre la santé du
 * MOTEUR DE RAFRAÎCHISSEMENT côté serveur (runs, sources, historique) via
 * `GET /api/internal/operator/observability` (`operator-observability-
 * client.ts`), lui-même un pont vers `@dealradar/ingestion` (server-only).
 *
 * Un instantané lu à l'ouverture, jamais un flux temps réel — même
 * discipline que `DiagnosticsScreen`. JAMAIS affiché ici : clé API, jeton,
 * URL authentifiée, valeur de credential — seulement des statuts/compteurs
 * (déjà garanti côté serveur par `getOperatorObservabilitySummary`, testé
 * pour ne jamais laisser fuiter un secret). Atteint uniquement depuis
 * `InternalToolsScreen` (gardé par `INTERNAL_TOOLS_ENABLED` en amont via
 * `ProfileScreen`) — même convention que `DiagnosticsScreen`/`BuildInfoScreen` :
 * aucune garde locale dupliquée ici.
 */
const READINESS_LABELS: Record<string, string> = {
  ready: "Prêt",
  missing_credentials: "Identifiants manquants",
  restricted: "Restreint (politique)",
  disabled_policy: "Désactivé (politique)",
  license_required: "Licence requise",
};

function readinessTone(readiness: string | undefined): StatusTone {
  if (readiness === "ready") return "success";
  if (readiness === undefined) return "neutral";
  return "warning";
}

export function OperatorDiagnosticsScreen({ onBack }: OperatorDiagnosticsScreenProps) {
  const [state, setState] = useState<{ status: "loading" | "loaded" | "error"; data: OperatorObservabilityResponse | null; message: string | null }>({
    status: "loading",
    data: null,
    message: null,
  });

  const refresh = useCallback(() => {
    setState({ status: "loading", data: null, message: null });
    fetchOperatorObservability()
      .then((data) => setState({ status: "loaded", data, message: null }))
      .catch((error: unknown) => {
        const message = error instanceof OperatorObservabilityError ? error.message : "Une erreur inattendue est survenue.";
        setState({ status: "error", data: null, message });
      });
  }, []);

  useEffect(() => refresh(), [refresh]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Diagnostics opérateur</Text>

      {state.status === "loading" && (
        <Card style={styles.section}>
          <Text style={styles.value}>Chargement…</Text>
        </Card>
      )}

      {state.status === "error" && (
        <Card style={styles.section}>
          <Text style={styles.error}>{state.message}</Text>
        </Card>
      )}

      {state.status === "loaded" && state.data && <OperatorDiagnosticsContent data={state.data} />}

      <AppButton title="Rafraîchir" onPress={refresh} variant="secondary" icon="refresh" />
      <AppButton title="Retour" onPress={onBack} variant="ghost" />
    </ScrollView>
  );
}

function OperatorDiagnosticsContent({ data }: { data: OperatorObservabilityResponse }) {
  const { summary, historicalEngine } = data;
  const lastRun = summary.recentRuns[0] ?? null;
  const recentFailures = summary.failedTargetsByReason.slice(0, 5);

  return (
    <>
      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Moteur d'historique</Text>
        <Row label="Tables disponibles" value={<StatusValue tone={historicalEngine.allTablesAvailable ? "success" : "danger"} text={historicalEngine.allTablesAvailable ? "OUI" : "NON"} />} />
        {!historicalEngine.allTablesAvailable && (
          <Text style={styles.hint}>
            Tables manquantes : {historicalEngine.tables.filter((t) => !t.available).map((t) => t.table).join(", ") || "—"}
          </Text>
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Cibles de recherche</Text>
        <Row label="Dues" value={<Text style={styles.value}>{summary.dueTargetCount}</Text>} />
        <Row label="En retard" value={<Text style={styles.value}>{summary.overdueTargetCount}</Text>} />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Dernier run de rafraîchissement</Text>
        {lastRun ? (
          <>
            <Row label="Démarré" value={<Text style={styles.value}>{lastRun.startedAt}</Text>} />
            <Row label="Réussi" value={<StatusValue tone={lastRun.success ? "success" : lastRun.success === false ? "danger" : "neutral"} text={lastRun.success === null ? "en cours" : lastRun.success ? "OUI" : "NON"} />} />
            <Row label="Expiré (deadline)" value={<StatusValue tone={lastRun.timedOut ? "warning" : "success"} text={lastRun.timedOut ? "OUI" : "NON"} />} />
            <Row label="Budget épuisé" value={<StatusValue tone={lastRun.budgetExhausted ? "warning" : "success"} text={lastRun.budgetExhausted ? "OUI" : "NON"} />} />
            <Row label="Cibles réclamées" value={<Text style={styles.value}>{lastRun.targetsClaimed}</Text>} />
            <Row label="Cibles réussies" value={<Text style={styles.value}>{lastRun.targetsSucceeded}</Text>} />
            <Row label="Cibles échouées" value={<Text style={styles.value}>{lastRun.targetsFailed}</Text>} />
          </>
        ) : (
          <Text style={styles.value}>Aucun run récent</Text>
        )}
        <Row label="Taux de réussite (fenêtre récente)" value={<Text style={styles.value}>{summary.successRate === null ? "—" : `${Math.round(summary.successRate)}%`}</Text>} />
        <Row label="Runs à budget épuisé" value={<Text style={styles.value}>{summary.budgetExhaustedRunCount}</Text>} />
        <Row label="Runs expirés" value={<Text style={styles.value}>{summary.timedOutRunCount}</Text>} />
      </Card>

      {recentFailures.length > 0 && (
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Échecs récents par raison</Text>
          {recentFailures.map((entry) => (
            <Row key={entry.reason} label={entry.reason} value={<Text style={styles.value}>{entry.count}</Text>} />
          ))}
        </Card>
      )}

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Préparation des sources</Text>
        {summary.sourceReadiness.length === 0 && <Text style={styles.value}>Aucune donnée</Text>}
        {summary.sourceReadiness.map((entry) => (
          <Row key={entry.source} label={entry.source} value={<StatusValue tone={readinessTone(entry.readiness)} text={(entry.readiness && READINESS_LABELS[entry.readiness]) ?? entry.readiness ?? "Inconnu"} />} />
        ))}
        <Text style={styles.hint}>Reflète l'environnement de ce serveur (web) — peut différer de l'environnement du worker de rafraîchissement.</Text>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {value}
    </View>
  );
}

function StatusValue({ tone, text }: { tone: StatusTone; text: string }) {
  return (
    <View style={styles.statusValue}>
      <StatusDot tone={tone} />
      <Text style={styles.value}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  title: { ...typography.title, color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary, marginBottom: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  label: { ...typography.body, color: colors.textSecondary, flexShrink: 1 },
  value: { ...typography.bodyStrong, color: colors.textPrimary, flexShrink: 1, textAlign: "right" },
  hint: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.body, color: colors.danger },
  statusValue: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
