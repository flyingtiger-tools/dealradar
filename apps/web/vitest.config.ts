import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Config minimale — seul ajout par rapport au zéro-config des autres
 * paquets (`packages/*`) : l'alias `@/*` que Next.js résout via
 * `tsconfig.json`, que vitest ne connaît pas nativement.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
