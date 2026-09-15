import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { TcgCardProvidedHints } from "@dealradar/contracts";
import { AppButton } from "../../components/ui/AppButton";
import { borderWidth, colors, radius, spacing, typography } from "../../theme/tokens";

const CONFIRMATION_FIELDS: { key: keyof TcgCardProvidedHints; label: string }[] = [
  { key: "cardName", label: "Nom de la carte" },
  { key: "setName", label: "Set / extension" },
  { key: "cardNumber", label: "Numéro" },
  { key: "variant", label: "Variante" },
  { key: "language", label: "Langue" },
  { key: "gradingCompany", label: "Société de gradation" },
  { key: "grade", label: "Note" },
];

export interface ConfirmationFormScreenProps {
  /** `isManualEntry` : aucune extraction visuelle préalable (saisie manuelle directe) — texte d'en-tête différent, même formulaire (voir `TcgScanScreen.tsx`, `state.requestId === ""`). */
  isManualEntry: boolean;
  fields: TcgCardProvidedHints;
  onFieldChange: (field: keyof TcgCardProvidedHints, value: string | null) => void;
  onSubmit: () => void;
}

export function ConfirmationFormScreen({ isManualEntry, fields, onFieldChange, onSubmit }: ConfirmationFormScreenProps) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{isManualEntry ? "Renseigne les informations imprimées sur la carte" : "Confirme ou corrige les champs détectés"}</Text>
      {CONFIRMATION_FIELDS.map(({ key, label }) => (
        <View key={key} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.input}
            placeholder={label}
            placeholderTextColor={colors.textMuted}
            value={fields[key] ?? ""}
            onChangeText={(text) => onFieldChange(key, text.length > 0 ? text : null)}
            accessibilityLabel={label}
          />
        </View>
      ))}
      <AppButton title="Rechercher avec ces informations" onPress={onSubmit} disabled={!fields.cardName} icon="checkmark-circle" style={styles.submit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.subtitle, color: colors.textPrimary, marginBottom: spacing.sm },
  fieldRow: { gap: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.textSecondary },
  input: {
    borderWidth: borderWidth.thin,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  submit: { marginTop: spacing.md },
});
