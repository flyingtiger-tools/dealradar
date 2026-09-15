import { StyleSheet, View } from "react-native";
import { colors } from "../../theme/tokens";

export interface ScanFrameProps {
  width?: number;
  height?: number;
}

const CORNER = 28;
const THICKNESS = 3;

/**
 * Cadre de capture "coins précis" (Phase 7, LOT "visual product pass") —
 * 4 crochets d'angle façon viseur d'appareil photo, plutôt qu'un simple
 * rectangle en pointillés. Repère visuel uniquement (proportions carte TCG
 * standard 63×88mm, comme l'ancien cadre) — ne déclenche rien, ne cadre
 * rien réellement (la vraie capture reste la caméra native via
 * `expo-image-picker`, inchangée).
 */
export function ScanFrame({ width = 210, height = 292 }: ScanFrameProps) {
  return (
    <View style={[styles.container, { width, height }]}>
      <View style={[styles.corner, styles.topLeft]} />
      <View style={[styles.corner, styles.topRight]} />
      <View style={[styles.corner, styles.bottomLeft]} />
      <View style={[styles.corner, styles.bottomRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: "relative" },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: colors.primary },
  topLeft: { top: 0, left: 0, borderLeftWidth: THICKNESS, borderTopWidth: THICKNESS, borderTopLeftRadius: 12 },
  topRight: { top: 0, right: 0, borderRightWidth: THICKNESS, borderTopWidth: THICKNESS, borderTopRightRadius: 12 },
  bottomLeft: { bottom: 0, left: 0, borderLeftWidth: THICKNESS, borderBottomWidth: THICKNESS, borderBottomLeftRadius: 12 },
  bottomRight: { bottom: 0, right: 0, borderRightWidth: THICKNESS, borderBottomWidth: THICKNESS, borderBottomRightRadius: 12 },
});
