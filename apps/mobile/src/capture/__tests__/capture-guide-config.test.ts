import { DEFAULT_CAPTURE_GUIDE_CONFIG } from "../capture-guide-config";

describe("DEFAULT_CAPTURE_GUIDE_CONFIG", () => {
  it("est configurable par l'appelant — aucune valeur métier figée dans le module (ADR 0013)", () => {
    expect(DEFAULT_CAPTURE_GUIDE_CONFIG.aspectRatio).toBeGreaterThan(0);
    expect(DEFAULT_CAPTURE_GUIDE_CONFIG.widthFraction).toBeGreaterThan(0);
    expect(DEFAULT_CAPTURE_GUIDE_CONFIG.widthFraction).toBeLessThanOrEqual(1);
    expect(typeof DEFAULT_CAPTURE_GUIDE_CONFIG.instructionText).toBe("string");
  });

  it("aucune mention d'une catégorie métier dans le texte par défaut", () => {
    const lower = DEFAULT_CAPTURE_GUIDE_CONFIG.instructionText.toLowerCase();
    expect(lower).not.toMatch(/pokemon|pokémon|tcg|carte à collectionner|lego/);
  });
});
