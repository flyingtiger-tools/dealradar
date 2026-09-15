import type { RafState } from "../../theme/raf-mapping";
import { colors } from "../../theme/tokens";

/**
 * Registry typé des assets Raf (Phase 23, LOT "fondation produit Raf").
 *
 * `getRafAsset(state)` est le SEUL point d'accès à un visuel Raf dans toute
 * l'app — aucun composant ne doit `require()` une image Raf directement.
 *
 * **Assets réels introuvables dans ce repo** : recherche exhaustive
 * effectuée (`apps/mobile`, tout le monorepo) — aucun PNG/SVG/board Raf
 * commité, aucun dossier `assets/`/`boards`/`brand`/`design` contenant quoi
 * que ce soit lié à "raf" (voir docs/mobile/ui-product-foundation.md,
 * section "Assets Raf"). Architecture de remplacement ci-dessous : un
 * placeholder par état (emoji + couleur de fond, thème sombre), zéro
 * dépendance native ajoutée (pas de react-native-svg), pour ne jamais
 * bloquer le développement des écrans en attendant les vrais visuels.
 *
 * **Pour brancher les vrais assets plus tard** : ajouter un fichier PNG/WebP
 * par état sous `src/assets/raf/images/<state>.png`, puis remplacer
 * uniquement `PLACEHOLDER_BY_STATE` ci-dessous par des `require(...)` — la
 * signature de `getRafAsset()` et tous ses appelants (`RafAvatar`,
 * `RafIllustration`, etc.) restent inchangés.
 */

export interface RafAssetDescriptor {
  state: RafState;
  /**
   * `"placeholder"` : rendu emoji + couleur (aucun fichier image).
   * `"image"` : rendu `<Image source={image} />` — réservé pour quand de
   * vrais fichiers existeront sous `src/assets/raf/images/`.
   */
  kind: "placeholder" | "image";
  /** Emoji de repli — toujours défini, même pour `kind: "image"` (repli si le require échoue en dev). */
  emoji: string;
  /** Couleur de fond du cercle/carte placeholder. */
  backgroundColor: string;
  /** Légende accessible (screen reader) — jamais un texte technique (voir Phase 25 accessibilité). */
  accessibilityLabel: string;
}

const RAF_ASSETS: Record<RafState, RafAssetDescriptor> = {
  neutral: { state: "neutral", kind: "placeholder", emoji: "🐦", backgroundColor: colors.surfaceRaised, accessibilityLabel: "Raf, au repos" },
  happy: { state: "happy", kind: "placeholder", emoji: "🐦", backgroundColor: colors.success, accessibilityLabel: "Raf, content" },
  clever: { state: "clever", kind: "placeholder", emoji: "🧐", backgroundColor: colors.primary, accessibilityLabel: "Raf, malicieux" },
  thinking: { state: "thinking", kind: "placeholder", emoji: "🤔", backgroundColor: colors.surfaceRaised, accessibilityLabel: "Raf réfléchit" },
  analyzing: { state: "analyzing", kind: "placeholder", emoji: "🔎", backgroundColor: colors.primary, accessibilityLabel: "Raf analyse" },
  searching: { state: "searching", kind: "placeholder", emoji: "🔍", backgroundColor: colors.primary, accessibilityLabel: "Raf cherche sur le marché" },
  scanning: { state: "scanning", kind: "placeholder", emoji: "📸", backgroundColor: colors.primary, accessibilityLabel: "Raf scanne" },
  warning: { state: "warning", kind: "placeholder", emoji: "😬", backgroundColor: colors.warning, accessibilityLabel: "Raf, prudent" },
  badDeal: { state: "badDeal", kind: "placeholder", emoji: "👎", backgroundColor: colors.danger, accessibilityLabel: "Raf, mauvaise affaire" },
  goodDeal: { state: "goodDeal", kind: "placeholder", emoji: "👍", backgroundColor: colors.success, accessibilityLabel: "Raf, bonne affaire" },
  gem: { state: "gem", kind: "placeholder", emoji: "💎", backgroundColor: colors.success, accessibilityLabel: "Raf, pépite" },
  megaDeal: { state: "megaDeal", kind: "placeholder", emoji: "🤩", backgroundColor: colors.success, accessibilityLabel: "Raf, méga affaire" },
};

/** Repli si un état inconnu est fourni (ne devrait jamais arriver avec le typage `RafState`, mais évite un crash si une valeur brute non validée transite par du JSON). */
const FALLBACK_ASSET: RafAssetDescriptor = RAF_ASSETS.neutral;

export function getRafAsset(state: RafState): RafAssetDescriptor {
  return RAF_ASSETS[state] ?? FALLBACK_ASSET;
}
