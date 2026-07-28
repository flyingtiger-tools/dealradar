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
  test: {
    // `src/env.ts` valide ces variables au chargement du module — sans elles,
    // tout fichier de test qui importe (transitivement) `@/env` échoue dès la
    // collecte, avant même d'exécuter un test. Valeurs factices, jamais de
    // vraie URL/clé.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
});
