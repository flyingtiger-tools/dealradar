import type { Session } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { RafAvatar } from "../components/raf/RafAvatar";
import { Card } from "../components/ui/Card";
import { ListRow } from "../components/ui/ListRow";
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
 * Profil (Phase 20, LOT "visual product pass" : "liste structurée
 * premium"). Sections Compte / Préférences / Application / À propos,
 * chacune un groupe de `ListRow` dans UNE seule carte (Phase 25 : pas de
 * card-in-card, une carte par ligne remplacée par un groupe). "Outils
 * internes" reste une section séparée, visible uniquement sous
 * `INTERNAL_TOOLS_ENABLED` — même garde qu'avant ce lot.
 */
export function ProfileScreen({ session, onSignOut, onOpenInternalTools }: ProfileScreenProps) {
  const appVersion = Constants.expoConfig?.version ?? "—";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <RafAvatar state="neutral" size={96} />
        <Text style={styles.email}>{session.user.email ?? "Compte connecté"}</Text>
      </View>

      <Section title="Compte">
        <Card padded={false}>
          <View style={styles.padded}>
            <ListRow icon="person-outline" label="Email" value={session.user.email ?? "—"} last />
          </View>
        </Card>
      </Section>

      <Section title="Préférences">
        <Card padded={false}>
          <View style={styles.padded}>
            <ListRow icon="settings-outline" label="Préférences" value="Bientôt disponible" tone="muted" last />
          </View>
        </Card>
      </Section>

      <Section title="Application">
        <Card padded={false}>
          <View style={styles.padded}>
            <ListRow icon="information-circle-outline" label="Version" value={appVersion} last />
          </View>
        </Card>
      </Section>

      <Section title="À propos">
        <Card padded={false}>
          <View style={styles.padded}>
            <ListRow icon="shield-checkmark-outline" label="DealRadar" value="Intelligence de marché" last />
          </View>
        </Card>
      </Section>

      {INTERNAL_TOOLS_ENABLED && (
        <Section title="Outils internes" badge>
          <Card padded={false}>
            <View style={styles.padded}>
              <ListRow icon="construct-outline" label="Ouvrir les outils internes" onPress={onOpenInternalTools} last />
            </View>
          </Card>
        </Section>
      )}

      <AppButton title="Déconnexion" onPress={onSignOut} variant="danger" icon="log-out-outline" style={styles.signOut} />
    </ScrollView>
  );
}

function Section({ title, badge = false, children }: { title: string; badge?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge && <Badge label="INTERNE" tone="warning" />}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.background },
  header: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  email: { ...typography.subtitle, color: colors.textPrimary },
  section: { gap: spacing.xs },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { ...typography.eyebrow, color: colors.textSecondary },
  padded: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  signOut: { marginTop: spacing.md },
});
