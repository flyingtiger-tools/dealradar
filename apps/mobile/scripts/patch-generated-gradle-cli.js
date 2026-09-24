#!/usr/bin/env node
// Le dossier android/ est généré : réappliquer le wrapper Metro/Expo
// après chaque prebuild pour résoudre index.ts depuis apps/mobile.
const fs = require("fs");
const path = require("path");
const gradle = path.resolve(__dirname, "../android/app/build.gradle");
const source = fs.readFileSync(gradle, "utf8");
const line = '    cliFile = file("../../scripts/gradle-bundle-embed-entry-fix.js")';
let output;
if (/^\s*cliFile\s*=.*$/m.test(source)) {
  output = source.replace(/^\s*cliFile\s*=.*$/m, "\n" + line);
} else if (/^react\s*\{/m.test(source)) {
  output = source.replace(/^react\s*\{/m, (match) => match + "\n" + line);
} else {
  throw new Error("Bloc react introuvable dans android/app/build.gradle");
}
if (!output.includes(line)) throw new Error("Wrapper Expo non configuré");
fs.writeFileSync(gradle, output);
