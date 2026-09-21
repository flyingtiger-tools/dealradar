/**
 * Garde-fous d'activation des tests d'INTÉGRATION DB RÉELLE (LOT "Real DB
 * Integration + Exact Budget Enforcement + Runtime Observability", section
 * 1) — jamais activés par défaut, jamais dirigés vers la Production même
 * par erreur.
 *
 * Trois exigences cumulatives, toutes nécessaires :
 *  1. `ALLOW_DB_INTEGRATION_TESTS=true` posé EXPLICITEMENT — une intention
 *     déclarée, jamais une activation accidentelle par simple présence
 *     d'autres variables.
 *  2. Trois variables `TEST_DATABASE_*` DISTINCTES des variables
 *     Production (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/
 *     `DATABASE_URL` utilisées par `apps/workers/src/db.ts`) — un nom de
 *     variable différent est déjà un garde-fou structurel : copier/coller
 *     la mauvaise variable ne pointe jamais silencieusement vers la
 *     Production.
 *  3. Une vérification d'ÉGALITÉ explicite : si `TEST_DATABASE_SUPABASE_URL`
 *     ou `TEST_DATABASE_URL` coïncident BYTE POUR BYTE avec une variable
 *     Production déjà présente dans le même environnement, refus immédiat
 *     avec une erreur, jamais un test silencieusement exécuté contre la
 *     mauvaise base.
 *
 * Ce garde-fou reste "au mieux" (best-effort) — il ne peut pas deviner
 * qu'une URL de test "ressemble" à une URL de Production si aucune
 * variable Production n'est présente dans CET environnement pour la
 * comparaison. Documenté honnêtement, jamais présenté comme une garantie
 * absolue.
 */
export interface DbIntegrationConfig {
  /** Chaîne de connexion Postgres brute — utilisée UNIQUEMENT pour appliquer les migrations et le nettoyage (jamais pour le chemin RPC applicatif lui-même). */
  postgresConnectionString: string;
  /** URL Supabase/PostgREST du même projet jetable — utilisée par le client `@supabase/supabase-js`, exactement le même chemin que le code de production (`claimResearchTargets`/`releaseResearchTarget`). */
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

export function getDbIntegrationConfig(env: NodeJS.ProcessEnv = process.env): DbIntegrationConfig | null {
  if (env.ALLOW_DB_INTEGRATION_TESTS !== "true") return null;

  const postgresConnectionString = env.TEST_DATABASE_URL;
  const supabaseUrl = env.TEST_DATABASE_SUPABASE_URL;
  const supabaseServiceRoleKey = env.TEST_DATABASE_SUPABASE_SERVICE_ROLE_KEY;
  if (!postgresConnectionString || !supabaseUrl || !supabaseServiceRoleKey) return null;

  if (env.SUPABASE_URL && supabaseUrl === env.SUPABASE_URL) {
    throw new Error(
      "TEST_DATABASE_SUPABASE_URL est identique à SUPABASE_URL (variable Production, apps/workers/src/db.ts) — refus explicite, jamais utilisé pour un test d'intégration DB même avec ALLOW_DB_INTEGRATION_TESTS=true.",
    );
  }
  if (env.DATABASE_URL && postgresConnectionString === env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL est identique à DATABASE_URL (variable Production) — refus explicite.");
  }

  return { postgresConnectionString, supabaseUrl, supabaseServiceRoleKey };
}
