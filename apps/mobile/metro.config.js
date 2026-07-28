const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

// Monorepo pnpm : Metro doit connaître la racine du workspace (watchFolders)
// et les deux emplacements node_modules (app + racine) pour résoudre les
// dépendances hoistées dans le virtual store pnpm (ex. @babel/runtime).
// Absent à l'origine — bug réel rencontré en testant l'app sur l'émulateur
// (voir docs/mobile/readiness-audit.md), corrigé ici.
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// pnpm repose sur des symlinks pour le virtual store (.pnpm) — Metro ne les
// suit pas par défaut.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
