import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase service role — réservé aux workers.
 * Contourne la RLS : seul chemin d'écriture des données de marché.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour les workers.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
