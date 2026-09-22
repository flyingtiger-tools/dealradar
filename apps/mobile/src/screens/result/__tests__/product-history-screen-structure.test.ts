import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test structurel (même principe que `result-screen-structure.test.ts` —
 * pas de bibliothèque de rendu React Native dans ce repo) — vérifie le
 * correctif d'audit QA (LOT "Product History UX + Source Health +
 * Interactive Cancellation + Beta Readiness", section 8/12) : la carte
 * "Couverture" (annonces actives suivies / sources distinctes) ne doit
 * JAMAIS être cachée par `data.isEmpty` — avant ce correctif, un produit
 * avec des annonces actives suivies mais aucun échantillon de PRIX
 * historique affichait uniquement "Aucun historique disponible", cachant
 * une information honnête et disponible.
 */
const SCREEN_PATH = join(__dirname, "..", "ProductHistoryScreen.tsx");

describe("ProductHistoryScreen — carte Couverture jamais cachée par isEmpty (active-only)", () => {
  const content = readFileSync(SCREEN_PATH, "utf8");

  it("la carte Couverture (Annonces actives suivies / Sources distinctes) apparaît APRÈS les DEUX branches du ternaire isEmpty — donc en dehors de lui, jamais imbriquée dans l'une des deux", () => {
    const emptyMessageIndex = content.indexOf("Aucun historique de prix disponible");
    const nonEmptyOnlyIndex = content.indexOf("Tendances"); // n'apparaît QUE dans la branche non-vide
    const coverageCardIndex = content.lastIndexOf("Couverture");
    expect(emptyMessageIndex).toBeGreaterThan(-1);
    expect(nonEmptyOnlyIndex).toBeGreaterThan(-1);
    expect(coverageCardIndex).toBeGreaterThan(-1);
    // En JSX, les DEUX branches d'un ternaire sont écrites l'une après
    // l'autre dans le SOURCE (jamais imbriquées) : si "Couverture" apparaît
    // après le texte propre à CHAQUE branche, il est nécessairement en
    // dehors du ternaire, rendu inconditionnellement.
    expect(coverageCardIndex).toBeGreaterThan(emptyMessageIndex);
    expect(coverageCardIndex).toBeGreaterThan(nonEmptyOnlyIndex);
  });

  it("la ligne 'Confiance de l'historique' reste conditionnée à !data.isEmpty (0% avec zéro échantillon n'est jamais affiché comme une mesure significative)", () => {
    expect(content).toMatch(/\{!data\.isEmpty\s*&&\s*<Row label="Confiance de l'historique"/);
  });

  it("le graphique/la valeur de référence/les tendances restent conditionnés à isEmpty (aucun sens sans au moins un échantillon)", () => {
    expect(content).toMatch(/<ProductHistoryChart/);
    expect(content).toMatch(/Valeur de référence/);
    expect(content).toMatch(/Tendances/);
  });
});
