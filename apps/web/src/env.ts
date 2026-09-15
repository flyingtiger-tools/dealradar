import { z } from "zod";

/**
 * Variables d'environnement validées au démarrage.
 * Un env manquant fait échouer le build — jamais une erreur silencieuse en prod.
 */
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Pipeline TCG serverless synchrone (/api/internal/tcg/analyze, lot
  // "journée autonome") — toutes optionnelles, dégradation gracieuse même
  // esprit que `apps/workers/src/ingestion/ai-provider-config.ts`. Jamais
  // exposées côté client (aucun préfixe NEXT_PUBLIC_) — restent côté
  // serveur Vercel uniquement, jamais dans l'APK mobile.
  AI_PROVIDER: z.enum(["openai", "anthropic", "groq", "openrouter"]).optional(),
  AI_MODEL: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  JUSTTCG_API_KEY: z.string().min(1).optional(),
  AI_DAILY_BUDGET_USD: z.coerce.number().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export const env = {
  ...clientSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  }),
  ...serverSchema.parse(process.env),
};
