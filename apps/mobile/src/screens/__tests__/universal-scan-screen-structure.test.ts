import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Garanties structurelles (LOT "rendre le scan universel accessible dans
 * l'app") — même approche que
 * `navigation/__tests__/structure-isolation.test.ts` (pas de bibliothèque
 * de rendu React Native dans ce repo) : analyse le code source réel plutôt
 * que de monter un composant. Garantit que `UniversalScanScreen` ne peut
 * structurellement jamais router une catégorie non-Pokémon vers
 * `tcgAdapter`, et qu'il atteint bien `ResultScreen` (jamais un second
 * écran de résultat dupliqué).
 */

const SRC_ROOT = join(__dirname, "..");

describe("UniversalScanScreen — routage adaptateur", () => {
  const content = readFileSync(join(SRC_ROOT, "UniversalScanScreen.tsx"), "utf8");

  it("importe genericObjectAdapters, jamais tcg-adapter (seule la documentation peut le mentionner)", () => {
    expect(content).toMatch(/genericObjectAdapters/);
    expect(content).not.toMatch(/from ["'].*tcg-adapter["']/);
  });

  it("appelle identifyCapture avec genericObjectAdapters comme liste d'adaptateurs", () => {
    expect(content).toMatch(/identifyCapture\(\s*capture,\s*category,\s*genericObjectAdapters/);
  });

  it("atteint ResultScreen pour afficher le résultat, jamais un second écran de résultat", () => {
    expect(content).toMatch(/<ResultScreen/);
  });

  it("sauvegarde le résultat en historique via saveAnalysisResultToHistory, comme TcgScanScreen", () => {
    expect(content).toMatch(/saveAnalysisResultToHistory/);
  });

  it("navigation 'Voir l'historique' (LOT 'Product History UX...', section 2) : atteint ProductHistoryScreen via un callback, jamais un second écran de résultat dupliqué", () => {
    expect(content).toMatch(/<ProductHistoryScreen/);
    expect(content).toMatch(/onOpenProductHistory=/);
  });

  it("annulation interactive (LOT 'Product History UX...', section 6/7) : un AbortController pilote le signal transmis à identifyCapture, jamais un second mécanisme d'annulation", () => {
    expect(content).toMatch(/new AbortController\(\)/);
    expect(content).toMatch(/identifyCapture\(\s*capture,\s*category,\s*genericObjectAdapters,/s);
    expect(content).toMatch(/controller\.signal/);
  });

  it("annulation interactive : AnalysisLoadingScreen reçoit onCancel, qui appelle cancelAnalysis puis RESET immédiatement — jamais une attente de confirmation serveur avant de revenir à idle", () => {
    expect(content).toMatch(/<AnalysisLoadingScreen[^>]*onCancel=\{handleCancelAnalysis\}/);
    expect(content).toMatch(/cancelAnalysis\(idToCancel\)/);
    expect(content).toMatch(/dispatch\(\{\s*type:\s*"RESET"\s*\}\)/);
  });
});

describe("ScannerEntryScreen — aucun fallback silencieux vers Pokémon", () => {
  const content = readFileSync(join(SRC_ROOT, "ScannerEntryScreen.tsx"), "utf8");

  it("route explicitement via resolveScannerBody, ne réimplémente pas la décision localement", () => {
    expect(content).toMatch(/resolveScannerBody/);
  });

  it("rend TcgScanScreen seulement pour le corps 'pokemon_tcg', UniversalScanScreen sinon", () => {
    expect(content).toMatch(/body === "pokemon_tcg"/);
    expect(content).toMatch(/<TcgScanScreen/);
    expect(content).toMatch(/<UniversalScanScreen/);
  });
});
