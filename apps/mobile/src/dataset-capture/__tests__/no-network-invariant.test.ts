// Node natif (`node:fs`/`node:path`) — Jest exécute ce fichier sous Node, mais
// `apps/mobile` n'installe volontairement pas `@types/node` (RN n'a pas ces
// modules au runtime ; les ajouter globalement au projet risquerait de
// masquer une future utilisation accidentelle d'une API Node absente de
// React Native ailleurs dans l'app). Ce fichier est donc exclu de
// `tsc --noEmit` (voir tsconfig.json) — Jest continue de l'exécuter et de le
// transformer via Babel (pas tsc), donc le test lui-même reste actif.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Preuve mécanique du "0 CHF" (Phase 14) — vérifie par lecture de code
 * source que le dossier `dataset-capture/` (outil dev, aucun réseau) ET
 * l'écran qui l'expose (`screens/TcgDatasetCaptureTool.tsx`) ne référencent
 * JAMAIS les fonctions/modules qui déclenchent un appel réseau réel :
 * `uploadTcgCardPhoto`, `createAnalysis`, `pollAnalysisUntilSettled`,
 * `AIProvider.extract`, ni `fetch` directement, ni les modules
 * d'authentification/session qui portent le jeton utilisé par ces appels.
 *
 * Volontairement une vérification de CODE SOURCE (pas d'exécution d'un
 * composant) : un test d'architecture, pas un test de comportement — la
 * seule façon de garantir qu'AUCUN chemin, même non exercé par les tests
 * fonctionnels, ne pourrait un jour appeler un de ces symboles sans faire
 * échouer ce test en même temps que l'ajout du code fautif.
 */

const DATASET_CAPTURE_DIR = path.resolve(__dirname, "..");
const CAPTURE_TOOL_SCREEN = path.resolve(__dirname, "../../screens/TcgDatasetCaptureTool.tsx");

const FORBIDDEN_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "uploadTcgCardPhoto", pattern: /uploadTcgCardPhoto/ },
  { label: "createAnalysis", pattern: /createAnalysis/ },
  { label: "pollAnalysisUntilSettled", pattern: /pollAnalysisUntilSettled/ },
  { label: "deleteTcgCardPhoto", pattern: /deleteTcgCardPhoto/ },
  { label: "AIProvider (import direct)", pattern: /AIProvider/ },
  { label: "fetch(", pattern: /\bfetch\s*\(/ },
  { label: "import de ../api/tcg-upload-client", pattern: /api\/tcg-upload-client/ },
  { label: "import de ../api/analyses-client", pattern: /api\/analyses-client/ },
  { label: "import de ../auth/session", pattern: /auth\/session/ },
  { label: "import de ../lib/supabase-client", pattern: /lib\/supabase-client/ },
  { label: "import de @supabase/supabase-js", pattern: /@supabase\/supabase-js/ },
  { label: "import de ../identification/tcg-adapter", pattern: /identification\/tcg-adapter/ },
];

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("dataset-capture/ — invariant \"aucun réseau\" (Phase 14)", () => {
  const sourceFiles = [
    ...listSourceFiles(DATASET_CAPTURE_DIR).filter((file) => !file.includes(`__tests__${path.sep}`)),
    CAPTURE_TOOL_SCREEN,
  ];

  it("le dossier contient bien des fichiers source à vérifier (le test ne passe pas vide)", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles)("%s ne référence aucun symbole réseau/authentification interdit", (file) => {
    const content = readFileSync(file, "utf8");
    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        throw new Error(`${path.relative(DATASET_CAPTURE_DIR, file)} référence un symbole interdit : "${label}" (pattern ${pattern}).`);
      }
    }
  });

  it("aucun fichier de ce dossier n'importe expo-constants (indice d'appel réseau applicatif — la base URL API n'a aucune raison d'être lue ici)", () => {
    for (const file of sourceFiles) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toMatch(/expo-constants/);
    }
  });
});
