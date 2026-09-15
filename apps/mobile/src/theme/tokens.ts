/**
 * Design tokens DealRadar (LOT "fondation produit Raf", 2026-09-15).
 *
 * Source unique de vérité pour les couleurs/espacements/rayons/typographie/
 * ombres — aucun écran ne doit coder une couleur en dur (ex. `#6A4CFF`
 * directement dans un `StyleSheet.create`) : importer `colors`/`theme`
 * d'ici à la place. Priorité au thème sombre (design brief) : `theme` EST
 * le thème sombre, il n'y a volontairement pas de bascule clair/sombre
 * aujourd'hui (aucun écran ne lit `useColorScheme()`) — ajouter un thème
 * clair plus tard n'exigerait que d'étendre ce fichier, jamais de toucher
 * aux écrans qui consomment déjà `theme.colors.*`.
 */

export const palette = {
  violet: "#6A4CFF",
  violetDark: "#5539DB",
  green: "#22C55E",
  yellow: "#FFC107",
  red: "#FF4D4F",
  dark: "#0F172A",
  offWhite: "#F8FAFC",
} as const;

export const colors = {
  // Fond / surfaces — thème sombre par défaut.
  background: palette.dark,
  surface: "#182236",
  surfaceRaised: "#212D45",
  border: "#2C3A57",

  // Texte
  textPrimary: palette.offWhite,
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  textOnPrimary: palette.offWhite,

  // Marque / actions
  primary: palette.violet,
  primaryPressed: palette.violetDark,

  // Sémantique — verdict/score/warnings (Phases 8-11).
  success: palette.green,
  warning: palette.yellow,
  danger: palette.red,

  // Verdict — un mapping dédié, jamais réutilisé pour autre chose que
  // l'affichage du verdict (voir theme/raf-mapping.ts).
  verdictBuy: palette.green,
  verdictReview: palette.yellow,
  verdictPass: palette.red,
  verdictUnknown: "#64748B",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: "700" as const, lineHeight: 34 },
  title: { fontSize: 20, fontWeight: "700" as const, lineHeight: 26 },
  subtitle: { fontSize: 16, fontWeight: "600" as const, lineHeight: 22 },
  body: { fontSize: 14, fontWeight: "400" as const, lineHeight: 20 },
  bodyStrong: { fontSize: 14, fontWeight: "600" as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: "400" as const, lineHeight: 16 },
  captionStrong: { fontSize: 12, fontWeight: "600" as const, lineHeight: 16 },
} as const;

/**
 * Ombres portées — react-native ne supporte pas `box-shadow` CSS, seulement
 * `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` (iOS) +
 * `elevation` (Android). Deux niveaux seulement (Phase "sans sur-
 * engineering") : `card` pour les cartes/boutons, `raised` pour ce qui
 * flotte au-dessus (modales, hero).
 */
export const shadows = {
  card: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  raised: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
} as const;

export const theme = { colors, spacing, radius, typography, shadows } as const;
export type Theme = typeof theme;
