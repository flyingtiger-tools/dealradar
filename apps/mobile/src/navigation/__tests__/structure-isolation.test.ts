// Node natif (`node:fs`/`node:path`) — même choix que
// `dataset-capture/__tests__/no-network-invariant.test.ts` : `apps/mobile`
// n'installe volontairement pas `@types/node` globalement (RN n'a pas ces
// modules au runtime, les ajouter risquerait de masquer une future
// utilisation accidentelle d'une API Node absente de RN ailleurs dans
// l'app) — ce fichier est donc exclu de `tsc --noEmit` (voir tsconfig.json),
// Jest continue de l'exécuter et de le transformer via Babel.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Tests structurels (Phase 30 "fixture isolation", "internal tools
 * visibility") — analyse le CODE SOURCE réel plutôt que de rendre des
 * composants (ce repo n'a pas de bibliothèque de rendu React Native, voir
 * docs/mobile/ui-product-foundation.md) : suffisant pour les deux garanties
 * qui comptent ici — quels fichiers importent les fixtures DEMO, et si la
 * garde `INTERNAL_TOOLS_ENABLED` protège bien l'entrée "Outils internes".
 */

const SRC_ROOT = join(__dirname, "..", "..");

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("Isolation des fixtures DEMO (Phase 16/30)", () => {
  it("fixtures/demo-results n'est importé que depuis screens/internal/", () => {
    const files = listSourceFiles(SRC_ROOT);
    const importers = files.filter((file) => {
      if (file.includes(`${join("fixtures", "demo-results")}`)) return false; // le fichier lui-même
      const content = readFileSync(file, "utf8");
      return /from ["'].*fixtures\/demo-results["']/.test(content);
    });

    const unauthorized = importers.filter((file) => !relative(SRC_ROOT, file).startsWith(join("screens", "internal")));

    expect(unauthorized).toEqual([]);
    // Au moins un importeur doit exister (UiPreviewScreen) — sinon le test serait vide de sens.
    expect(importers.length).toBeGreaterThan(0);
  });
});

describe("Visibilité des outils internes (Phase 3/30)", () => {
  it("BottomTabBar (navigation principale) ne référence jamais Dataset TCG ni les outils internes", () => {
    const content = readFileSync(join(SRC_ROOT, "navigation", "BottomTabBar.tsx"), "utf8");
    expect(content).not.toMatch(/dataset/i);
    expect(content).not.toMatch(/internal/i);
  });

  it("ProfileScreen ne rend l'entrée Outils internes que sous INTERNAL_TOOLS_ENABLED", () => {
    const content = readFileSync(join(SRC_ROOT, "screens", "ProfileScreen.tsx"), "utf8");
    expect(content).toMatch(/INTERNAL_TOOLS_ENABLED\s*&&/);
  });

  it("TcgDatasetCaptureTool garde sa propre garde indépendante (double garde, inchangée)", () => {
    const content = readFileSync(join(SRC_ROOT, "screens", "TcgDatasetCaptureTool.tsx"), "utf8");
    expect(content).toMatch(/INTERNAL_TOOLS_ENABLED/);
  });
});
