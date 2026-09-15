import { StyleSheet, Text, View } from "react-native";
import { getRafAsset } from "../../assets/raf/registry";
import type { RafState } from "../../theme/raf-mapping";
import { radius } from "../../theme/tokens";

export interface RafAvatarProps {
  state: RafState;
  /** Diamètre en px — 32 (statut inline), 48 (ligne de liste), 96 (header). */
  size?: 32 | 48 | 96;
}

/**
 * Petit portrait Raf circulaire — statut inline, header, ligne de liste.
 * Pour un visuel plus grand/illustratif (hero, empty state), voir
 * `RafIllustration`.
 */
export function RafAvatar({ state, size = 48 }: RafAvatarProps) {
  const asset = getRafAsset(state);
  const fontSize = Math.round(size * 0.5);
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: radius.pill, backgroundColor: asset.backgroundColor },
      ]}
      accessible
      accessibilityLabel={asset.accessibilityLabel}
      accessibilityRole="image"
    >
      <Text style={{ fontSize }}>{asset.emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
});
