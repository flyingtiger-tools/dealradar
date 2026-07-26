import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase service role — réservé aux workers.
 * Contourne la RLS : seul chemin d'écriture des données de marché.
 *
 * `SUPABASE_URL` (pas `NEXT_PUBLIC_SUPABASE_URL`) : ce process n'est pas du
 * Next.js, le préfixe `NEXT_PUBLIC_` y est trompeur (il suggère à tort une
 * variable exposée au bundle client).
 */
export function createServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour les workers.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
