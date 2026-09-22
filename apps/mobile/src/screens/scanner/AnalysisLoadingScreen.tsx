import { StyleSheet, Text, View } from "react-native";
import { RafIllustration } from "../../components/raf/RafIllustration";
import { RadarPulse } from "../../components/ui/RadarPulse";
import { AppButton } from "../../components/ui/AppButton";
import { getRafStateForProgress } from "../../theme/raf-mapping";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Phases réelles traversées par `TcgScanScreen`/`UniversalCaptureBetaScreen`
 * — "uploading" (envoi de la photo) puis "polling" (identification +
 * recherche de prix, couvre aussi `resubmitting` après confirmation
 * manuelle, UX identique). AUCUNE étape "Identification / Catalogue /
 * Marché / Prix / Verdict" n'est affichée séparément (Phase 7) : le
 * backend ne rapporte pas ces sous-étapes au client (une seule requête
 * HTTP synchrone côté `analyzeTcgCard`), donc les prétendre exécutées
 * séquentiellement serait un mensonge visuel.
 */
export type LoadingPhase = "uploading" | "polling";

const PHASE_LABEL: Record<LoadingPhase, string> = {
  uploading: "Envoi de la photo…",
  polling: "Analyse en cours…",
};

export interface AnalysisLoadingScreenProps {
  phase: LoadingPhase;
  /**
   * Annulation interactive (LOT "Product History UX + Source Health +
   * Interactive Cancellation + Beta Readiness", section 6/7) — optionnel,
   * OMIS par `TcgScanScreen.tsx` (aucun bouton d'annulation pour la
   * verticale TCG, règle produit explicite du lot, section 2). Fourni
   * uniquement par `UniversalScanScreen.tsx`. Doit revenir à un état local
   * propre IMMÉDIATEMENT (jamais attendre une confirmation serveur) — voir
   * l'appelant.
   */
  onCancel?: () => void;
}

/**
 * Écran d'attente (Phase 9, LOT "visual product pass" : "réellement
 * agréable, sans faux pourcentage, sans fausses étapes"). Le "market
 * pulse" (`RadarPulse`, anneaux animés) entoure Raf plutôt que de le
 * remplacer — aucun changement de direction artistique Raf (Phase 32),
 * juste un décor de fond en mouvement pendant une attente réelle.
 */
export function AnalysisLoadingScreen({ phase, onCancel }: AnalysisLoadingScreenProps) {
  return (
    <View style={styles.container}>
      <View style={styles.stack}>
        <View style={styles.pulseLayer}>
          <RadarPulse size={200} />
        </View>
        <RafIllustration state={getRafStateForProgress(phase)} size={120} pulse />
      </View>
      <Text style={styles.label}>{PHASE_LABEL[phase]}</Text>
      <Text style={styles.sublabel}>Un instant.</Text>
      {onCancel ? <AppButton title="Annuler" onPress={onCancel} variant="ghost" style={styles.cancelButton} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  stack: { alignItems: "center", justifyContent: "center" },
  pulseLayer: { position: "absolute" },
  label: { ...typography.subtitle, color: colors.textPrimary },
  sublabel: { ...typography.caption, color: colors.textSecondary },
  cancelButton: { marginTop: spacing.lg },
});
