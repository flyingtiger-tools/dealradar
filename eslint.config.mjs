// Configuration ESLint racine minimale et stricte.
// apps/web utilise eslint-config-next via son script `next lint` ;
// cette config couvre les packages Node (core, workers).
import tseslint from "typescript-eslint";

export default [
  {
    files: ["packages/**/src/**/*.ts", "apps/workers/src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-console": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
  {
    // Entrypoints CLI : sortie terminal humaine, jamais un service qui
    // journalise en continu — exception standard à no-console.
    files: ["packages/**/src/cli.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
