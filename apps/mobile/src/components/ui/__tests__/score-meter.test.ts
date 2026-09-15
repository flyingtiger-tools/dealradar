import { filledSegments, scoreSegmentTone } from "../ScoreConfidenceRow";
import { colors } from "../../../theme/tokens";

describe("filledSegments", () => {
  it("remplit tous les segments à 100", () => {
    expect(filledSegments(100, 6)).toBe(6);
  });

  it("ne remplit aucun segment à 0", () => {
    expect(filledSegments(0, 6)).toBe(0);
  });

  it("arrondit au plus proche plutôt que de tronquer", () => {
    // 78/100 * 6 = 4.68 -> 5, pas 4.
    expect(filledSegments(78, 6)).toBe(5);
  });

  it("reste dans les bornes même pour une valeur hors 0-100 (défensif)", () => {
    expect(filledSegments(150, 6)).toBe(6);
    expect(filledSegments(-10, 6)).toBe(0);
  });
});

describe("scoreSegmentTone", () => {
  it("associe chaque palier à la couleur sémantique attendue — jamais un seuil métier recalculé", () => {
    expect(scoreSegmentTone(85)).toBe(colors.success);
    expect(scoreSegmentTone(60)).toBe(colors.warning);
    expect(scoreSegmentTone(20)).toBe(colors.danger);
  });
});
