import type { Session } from "@supabase/supabase-js";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RafAvatar } from "../components/raf/RafAvatar";
import { Card } from "../components/ui/Card";
import { AppButton } from "../components/ui/AppButton";
import { Badge } from "../components/ui/Badge";
import { INTERNAL_TOOLS_ENABLED } from "../config/internal-tools";
import { colors, spacing, typography } from "../theme/tokens";

export interface ProfileScreenProps {
  session: Session;
  onSignOut: () => void;
  onOpenInternalTools: () => void;
}

/**
 * Profil (Phase 14) — Compte / Préférences / À propos / Déconnexion.
 * "Outils internes" (Phase 3) n'apparaît QUE sous `INTERNAL_TOOLS_ENABLED`
 * — jamais en build grand public, même garde que Dataset TCG partout
 * ailleurs dans l'app.
 */
export function ProfileScreen({ session, onSignOut, onOpenInternalTools }: ProfileScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <RafAvatar state="neutral" size={96} />
        <Text style={styles.email}>{session.user.email ?? "Compte connecté"}</Text>
      </View>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Compte</Text>
        <Text style={styles.row}>{session.user.email ?? "—"}</Text>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Préférences</Text>
        <Text style={styles.rowMuted}>Aucune préférence configurable pour l'instant.</Text>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>À propos</Text>
        <Text style={styles.rowMuted}>DealRadar — assistant d'intelligence de marché.</Text>
      </Card>

      {INTERNAL_TOOLS_ENABLED && (
        <Card style={styles.section}>
          <View style={styles.internalHeader}>
            <Text style={styles.sectionTitle}>Outils internes</Text>
            <Badge label="INTERNE" tone="warning" />
          </View>
          <AppButton title="Ouvrir les outils internes" onPress={onOpenInternalTools} variant="secondary" />
        </Card>
      )}

      <AppButton title="Déconnexion" onPress={onSignOut} variant="danger" style={styles.signOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.background },
  header: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  email: { ...typography.subtitle, color: colors.textPrimary },
  section: { gap: spacing.xs },
  sectionTitle: { ...typography.subtitle, color: colors.textPrimary, marginBottom: spacing.xs },
  row: { ...typography.body, color: colors.textPrimary },
  rowMuted: { ...typography.body, color: colors.textSecondary },
  internalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  signOut: { marginTop: spacing.md },
});
