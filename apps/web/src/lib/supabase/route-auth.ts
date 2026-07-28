import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";

/**
 * Vérificateur d'identité pour les Route Handlers `/api/v1/*` (ADR 0010).
 * Distinct de `server.ts` (session via cookies, réservée aux pages/Server
 * Actions) : un client mobile n'a pas de cookie de session, il envoie un
 * jeton d'accès Supabase dans `Authorization: Bearer <token>`. La clé
 * anonyme + `auth.getUser(token)` vérifie le jeton auprès de Supabase Auth
 * (jamais un simple décodage JWT local non vérifié).
 */
export async function authenticateBearerRequest(request: Request): Promise<{ userId: string } | null> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const supabase = createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return { userId: data.user.id };
}
