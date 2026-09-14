#!/usr/bin/env node
/**
 * Contournement d'un bug réel de `@expo/cli export:embed` dans ce monorepo
 * pnpm : le plugin Gradle React Native (`BundleHermesCTask`) convertit le
 * chemin `--entry-file` absolu (correctement calculé dans
 * `android/app/build.gradle`) en chemin RELATIF avant de lancer la commande
 * (`entryFile.cliPath(rootFile)`, comportement normal du plugin, pas un bug
 * en soi). Mais `expo export:embed`, une fois invoqué avec ce chemin
 * relatif, résout `./index.ts` contre la racine du WORKSPACE pnpm
 * (`metro.config.js` y ajoute `workspaceRoot` à `watchFolders` pour la
 * résolution des dépendances hoistées) plutôt que contre la racine de
 * `apps/mobile` — d'où l'erreur observée : "Unable to resolve module
 * ./index.ts from <racine du repo>/.".
 *
 * Reproduit et confirmé hors Gradle (même erreur en invoquant `@expo/cli`
 * directement avec un `--entry-file` relatif, cwd=apps/mobile) — voir
 * docs/mobile/internal-build.md. Un `--entry-file` ABSOLU contourne le bug
 * (testé, fonctionne). Ce script sert de `cliFile` de remplacement pour le
 * plugin Gradle (voir `android/app/build.gradle`, propriété `cliFile`) :
 * il réécrit `--entry-file` en absolu puis délègue intégralement au vrai
 * `@expo/cli`, sans autre changement de comportement.
 *
 * `android/` est généré (gitignoré, `expo prebuild --clean` le régénère
 * entièrement) — ce fichier-ci, dans `apps/mobile/scripts/`, est committé
 * et survit à toute régénération ; seule la référence `cliFile` dans
 * `android/app/build.gradle` doit être réappliquée après un `prebuild`
 * (voir la note dans docs/mobile/internal-build.md).
 */
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

const entryFileFlagIndex = args.indexOf("--entry-file");
if (entryFileFlagIndex !== -1 && args[entryFileFlagIndex + 1] && !path.isAbsolute(args[entryFileFlagIndex + 1])) {
  args[entryFileFlagIndex + 1] = path.resolve(projectRoot, args[entryFileFlagIndex + 1]);
}

const realCliFile = require.resolve("@expo/cli", {
  paths: [require.resolve("expo/package.json", { paths: [projectRoot] })],
});

const result = spawnSync(process.execPath, [realCliFile, ...args], {
  stdio: "inherit",
  cwd: projectRoot,
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
