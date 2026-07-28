// Config locale (le eslint.config.mjs racine ne couvre que packages/**/src et
// apps/workers/src) — mêmes règles de base, adaptées au JSX React Native.
import tseslint from "typescript-eslint";

export default [
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "__tests__/**/*.ts", "__tests__/**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
];
