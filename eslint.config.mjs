// Configuration ESLint racine minimale et stricte.
// apps/web utilise eslint-config-next via son script `next lint` ;
// cette config couvre les packages Node (core, workers).
export default [
  {
    files: ["packages/**/src/**/*.ts", "apps/workers/src/**/*.ts"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      "no-console": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
