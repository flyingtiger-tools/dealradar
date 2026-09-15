/**
 * Contraste WCAG 2.1 (luminance relative) — utilitaire pur, aucune
 * dépendance React Native, pour vérifier MÉCANIQUEMENT (pas seulement une
 * fois à la main) que les paires fond/texte de la palette restent
 * lisibles. Voir `components/ui/__tests__/badge-contrast.test.ts` pour
 * l'usage réel.
 */

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Ratio de contraste entre deux couleurs hex (`#RRGGBB`) — toujours ≥ 1. */
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Seuils WCAG AA. */
export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;
