// Test structurel (Phase 35, LOT "visual product pass") — analyse le code
// source plutôt que de rendre le composant (pas de bibliothèque de rendu
// React Native dans ce repo, voir `navigation/__tests__/structure-
// isolation.test.ts` pour le même principe). Suffisant pour vérifier un
// ORDRE de rendu simple : `PriceHero` n'est jamais conditionné à la même
// branche que "Prix par source" (voir le fichier), donc leur ordre
// d'apparition dans le JSX source EST leur ordre de rendu réel.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RESULT_SCREEN_PATH = join(__dirname, "..", "ResultScreen.tsx");
const HISTORY_SCREEN_PATH = join(__dirname, "..", "..", "HistoryScreen.tsx");
const HOME_SCREEN_PATH = join(__dirname, "..", "..", "HomeScreen.tsx");

describe("Hiérarchie de ResultScreen (Phase 10/11, LOT visual product pass)", () => {
  const content = readFileSync(RESULT_SCREEN_PATH, "utf8");

  it("affiche le prix (PriceHero) avant le détail 'Prix par source'", () => {
    const heroIndex = content.indexOf("<PriceHero");
    const detailIndex = content.indexOf("Prix par source");
    expect(heroIndex).toBeGreaterThan(-1);
    expect(detailIndex).toBeGreaterThan(-1);
    expect(heroIndex).toBeLessThan(detailIndex);
  });

  it("ne construit jamais de JSON brut affiché à l'utilisateur", () => {
    expect(content).not.toMatch(/JSON\.stringify/);
  });

  it("MarketInsightCard (LOT Interactive History..., section 3) est conditionné à view.marketInsight, jamais rendu inconditionnellement (garantie TCG : marketInsight est toujours null pour un résultat TCG)", () => {
    expect(content).toMatch(/\{view\.marketInsight\s*&&\s*\(?\s*<MarketInsightCard/);
  });

  it("onOpenProductHistory (LOT 'Product History UX...', section 2) n'est transmis qu'à MarketInsightCard — jamais un second point d'accès à ProductHistoryScreen", () => {
    expect(content).not.toMatch(/import.*ProductHistoryScreen/);
    expect(content).toMatch(/onViewHistory=\{view\.productKey && onOpenProductHistory \? onOpenProductHistory : undefined\}/);
  });

  it("MarketInsightCard apparaît après 'Prix par source' et avant WhyPanel — jamais de fourchette de prix dupliquée avant PriceHero/ScoreConfidenceRow", () => {
    const detailIndex = content.indexOf("Prix par source");
    const insightIndex = content.indexOf("<MarketInsightCard");
    const whyPanelIndex = content.indexOf("<WhyPanel");
    expect(detailIndex).toBeGreaterThan(-1);
    expect(insightIndex).toBeGreaterThan(-1);
    expect(whyPanelIndex).toBeGreaterThan(-1);
    expect(detailIndex).toBeLessThan(insightIndex);
    expect(insightIndex).toBeLessThan(whyPanelIndex);
  });
});

describe("HistoryScreen utilise le vrai dépôt (Phase 17, LOT visual product pass)", () => {
  const content = readFileSync(HISTORY_SCREEN_PATH, "utf8");

  it("importe history/storage, jamais les fixtures DEMO", () => {
    expect(content).toMatch(/from ["']\.\.\/history\/storage["']/);
    expect(content).not.toMatch(/demo-results/);
  });
});

describe("HomeScreen n'invente aucune activité (Phase 4, LOT visual product pass)", () => {
  const content = readFileSync(HOME_SCREEN_PATH, "utf8");

  it("charge les dernières analyses depuis le vrai dépôt, jamais un chiffre fabriqué", () => {
    expect(content).toMatch(/from ["']\.\.\/history\/storage["']/);
    expect(content).not.toMatch(/demo-results/);
  });

  it("ne prétend plus suivre des produits ou des alertes qui n'existent pas", () => {
    expect(content).not.toMatch(/Aucun produit suivi/);
    expect(content).not.toMatch(/Aucune alerte/);
  });
});
