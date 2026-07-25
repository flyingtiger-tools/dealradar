import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/env";

/** Client Supabase côté navigateur — clé anon, protégé par RLS. */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
