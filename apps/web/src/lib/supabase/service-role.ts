import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

/**
 * Client Supabase service role pour apps/web — réservé aux Route Handlers
 * `/api/v1/*` qui doivent écrire au-delà de ce que la RLS autorise un
 * utilisateur à faire lui-même (ex. réservation de rate limit). Même
 * principe que `apps/workers/src/db.ts` : chaque requête ci-dessus filtre
 * explicitement par `user_id` — le contournement de la RLS ne dispense
 * jamais d'une vérification applicative de propriété (ADR 0010, menace 15).
 */
export function createServiceRoleClient() {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY est requis pour les routes /api/v1/analyses.");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false } });
}
