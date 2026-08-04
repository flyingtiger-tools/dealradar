import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase-client";

/**
 * Fine couche testable autour de `supabase.auth` (LOT 9) — isole les
 * fonctions dont dépend le reste de l'app (`analyses-client.ts`,
 * `tcg-upload-client.ts`, `App.tsx`) du SDK Supabase lui-même, pour rester
 * mockable en test sans dépendre du client réseau réel.
 */

export interface SignInResult {
  error: string | null;
}

/** Session courante (déjà persistée/rafraîchie par le SDK) — jamais un jeton saisi manuellement. */
export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Access token courant, ou `null` si aucune session active — jamais une valeur devinée ou mise en cache localement au-delà de ce que le SDK gère déjà. */
export async function getCurrentAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.access_token ?? null;
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.user.id ?? null;
}

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? error.message : null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** S'abonne aux changements de session (connexion, déconnexion, rafraîchissement, expiration) — retourne une fonction de désabonnement. */
export function onSessionChange(callback: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
