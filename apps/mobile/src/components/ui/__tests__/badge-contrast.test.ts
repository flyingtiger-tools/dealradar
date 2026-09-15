import { TONE_COLORS } from "../Badge";
import { DECISION_COLOR } from "../VerdictBanner";
import { colors } from "../../../theme/tokens";
import { contrastRatio, WCAG_AA_LARGE_TEXT, WCAG_AA_NORMAL_TEXT } from "../../../theme/contrast";

/**
 * Garde-fou d'accessibilité (Phase 23, LOT "package V3") — vérifie
 * MÉCANIQUEMENT chaque paire fond/texte réellement utilisée par `Badge`
 * et `VerdictBanner`, plutôt qu'un calcul fait une fois à la main puis
 * jamais revérifié (voir le contraste `danger` corrigé au lot précédent :
 * 3.12:1 -> 5.46:1). Un futur changement de palette qui casserait un
 * contraste ferait échouer ce test immédiatement.
 */
describe("Badge — contraste des tons", () => {
  it("chaque ton (texte captionStrong, 12px) atteint au moins le seuil AA texte normal", () => {
    for (const [tone, { bg, fg }] of Object.entries(TONE_COLORS)) {
      const ratio = contrastRatio(bg, fg);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      if (ratio < WCAG_AA_NORMAL_TEXT) throw new Error(`Badge tone "${tone}": ${ratio.toFixed(2)}:1`);
    }
  });
});

describe("VerdictBanner — contraste des décisions", () => {
  it("chaque couleur de décision atteint au moins le seuil AA grand texte (title, 20px bold)", () => {
    for (const [decision, bg] of Object.entries(DECISION_COLOR)) {
      const ratio = contrastRatio(bg, colors.background);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE_TEXT);
      if (ratio < WCAG_AA_LARGE_TEXT) throw new Error(`Decision "${decision}": ${ratio.toFixed(2)}:1`);
    }
  });
});
