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

/**
 * Distinction READY / DEGRADED / BLOCKED / NOT CONFIGURED (LOT "Product
 * History UX + Source Health + Interactive Cancellation + Beta Readiness",
 * section 9) — appliquée de façon cohérente à CHAQUE ligne de diagnostic
 * qui a un état binaire/gradué (santé de source, disponibilité de table).
 */
type ClearStatus = "READY" | "DEGRADED" | "BLOCKED" | "NOT_CONFIGURED";

const CLEAR_STATUS_LABELS: Record<ClearStatus, string> = { READY: "READY", DEGRADED: "DEGRADED", BLOCKED: "BLOCKED", NOT_CONFIGURED: "NOT CONFIGURED" };
const CLEAR_STATUS_TONES: Record<ClearStatus, StatusTone> = { READY: "success", DEGRADED: "warning", BLOCKED: "danger", NOT_CONFIGURED: "neutral" };

function healthLevelToClearStatus(level: "healthy" | "degraded" | "unhealthy"): ClearStatus {
  if (level === "healthy") return "READY";
  if (level === "degraded") return "DEGRADED";
  return "BLOCKED";
}

/** `null`/absent -> "jamais" — jamais une durée fabriquée à partir d'une absence de donnée. */
function formatAgeFromNow(iso: string | null): string {
  if (!iso) return "jamais";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `il y a ${Math.round(ms / (1000 * 60))} min`;
  if (hours < 48) return `il y a ${Math.round(hours)} h`;
  return `il y a ${Math.round(hours / 24)} j`;
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
        <Row label="Tables disponibles" value={<StatusValue tone={CLEAR_STATUS_TONES[historicalEngine.allTablesAvailable ? "READY" : "BLOCKED"]} text={CLEAR_STATUS_LABELS[historicalEngine.allTablesAvailable ? "READY" : "BLOCKED"]} />} />
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
        <Row label="Historique clairsemé (produits)" value={<Text style={styles.value}>{summary.sparseHistoryProductCount}</Text>} />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Dernier lot de rafraîchissement</Text>
        {lastRun ? (
          <>
            <Row label="Démarré" value={<Text style={styles.value}>{lastRun.startedAt}</Text>} />
            <Row label="Réussi" value={<StatusValue tone={lastRun.failed === 0 ? "success" : "danger"} text={lastRun.failed === 0 ? "OUI" : "NON"} />} />
            <Row label="Expiré (deadline)" value={<StatusValue tone={lastRun.timedOut ? "warning" : "success"} text={lastRun.timedOut ? "OUI" : "NON"} />} />
            <Row label="Budget épuisé" value={<StatusValue tone={lastRun.budgetExhausted ? "warning" : "success"} text={lastRun.budgetExhausted ? "OUI" : "NON"} />} />
            <Row label="Cibles réclamées" value={<Text style={styles.value}>{lastRun.claimed}</Text>} />
            <Row label="Cibles réussies" value={<Text style={styles.value}>{lastRun.succeeded}</Text>} />
            <Row label="Cibles échouées" value={<Text style={styles.value}>{lastRun.failed}</Text>} />
          </>
        ) : (
          <Text style={styles.value}>Aucun lot récent</Text>
        )}
        <Row label="Dernier succès" value={<Text style={styles.value}>{formatAgeFromNow(summary.latestSuccessfulTargetAt)}</Text>} />
        <Row label="Taux de réussite (fenêtre récente)" value={<Text style={styles.value}>{summary.successRate === null ? "—" : `${Math.round(summary.successRate * 100)}%`}</Text>} />
        <Row label="Lots à budget épuisé" value={<Text style={styles.value}>{summary.budgetExhaustedRunCount}</Text>} />
        <Row label="Lots expirés" value={<Text style={styles.value}>{summary.timedOutRunCount}</Text>} />
        <Row label="Abandons (déadline/annulation)" value={<Text style={styles.value}>{summary.abortedTargetCount}</Text>} />
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
        <Text style={styles.sectionTitle}>Santé des sources</Text>
        {summary.sourceHealth.length === 0 && <Text style={styles.value}>Aucune donnée</Text>}
        {summary.sourceHealth.map((entry) => (
          <View key={entry.source} style={styles.sourceHealthBlock}>
            <Row label={entry.source} value={<StatusValue tone={CLEAR_STATUS_TONES[healthLevelToClearStatus(entry.healthLevel)]} text={CLEAR_STATUS_LABELS[healthLevelToClearStatus(entry.healthLevel)]} />} />
            <Text style={styles.hint}>
              Dernier succès {formatAgeFromNow(entry.lastSuccessAt)} · dernier échec {formatAgeFromNow(entry.lastFailureAt)} · {entry.timeoutCount} timeout(s) · {entry.abortedCount} abandon(s) (jamais compté comme un échec)
            </Text>
          </View>
        ))}
      </Card>

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
  sourceHealthBlock: { gap: 2, marginBottom: spacing.xs },
  error: { ...typography.body, color: colors.danger },
  statusValue: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
});
