/**
 * Configuration du cadre de guidage — générique, paramétrable par
 * l'appelant. Aucune valeur métier ici ; un futur adapter (TCG ou autre)
 * fournit sa propre config (ex. ratio carte à jouer ≈ 0.716) sans que ce
 * module le sache (ADR 0013).
 */
export interface CaptureGuideConfig {
  /** Largeur/hauteur du cadre — ex. 0.716 pour une carte à jouer standard, 1 pour un carré. */
  aspectRatio: number;
  /** Texte affiché au-dessus du cadre — fourni par l'appelant, jamais figé ici. */
  instructionText: string;
  /** Largeur du cadre en fraction de la largeur de la vue caméra (0-1 exclusif). */
  widthFraction: number;
}

/** Config par défaut neutre — un appelant réel doit fournir la sienne plutôt que de s'y fier telle quelle. */
export const DEFAULT_CAPTURE_GUIDE_CONFIG: CaptureGuideConfig = {
  aspectRatio: 0.75,
  instructionText: "Alignez l'objet dans le cadre, à plat, sans reflet.",
  widthFraction: 0.62,
};
