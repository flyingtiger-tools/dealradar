import { getRafAsset } from "../registry";
import { ALL_RAF_STATES } from "../../../theme/raf-mapping";

/**
 * Test de complétude du registry (LOT "package visuel Raf") — garantit
 * qu'un état ajouté à `RafState`/`ALL_RAF_STATES` (theme/raf-mapping.ts)
 * a toujours une entrée correspondante ici. Sans ce test, ajouter un état
 * au type sans mettre à jour `RAF_ASSETS` serait détecté seulement par
 * `tsc` (déjà le cas) — ce test documente explicitement l'attente et
 * couvre aussi le comportement au runtime (JS pur, hors typage).
 */
describe("getRafAsset — complétude du registry", () => {
  it("retourne un descripteur valide pour chacun des états de ALL_RAF_STATES", () => {
    for (const state of ALL_RAF_STATES) {
      const asset = getRafAsset(state);
      expect(asset.state).toBe(state);
      expect(asset.emoji.length).toBeGreaterThan(0);
      expect(asset.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });

  it("aucun accessibilityLabel n'est un texte technique brut (jamais le nom d'état lui-même)", () => {
    for (const state of ALL_RAF_STATES) {
      const asset = getRafAsset(state);
      expect(asset.accessibilityLabel.toLowerCase()).not.toBe(state.toLowerCase());
    }
  });
});
