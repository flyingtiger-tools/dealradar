import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

/**
 * Client Supabase unique et partagé (LOT 9) — authentification réelle,
 * jamais un jeton collé manuellement. Seules des valeurs publiques
 * (URL du projet, clé "anon") sont utilisées ici ; aucune clé service_role
 * ni aucun secret serveur n'entre jamais dans le bundle mobile.
 *
 * - `storage: AsyncStorage` : la session (access token + refresh token)
 *   persiste entre les lancements de l'app, jamais dans un état React en
 *   clair.
 * - `autoRefreshToken: true` : le SDK rafraîchit lui-même le token avant
 *   expiration, tant que l'app est au premier plan (voir l'écouteur
 *   `AppState` ci-dessous — recommandation officielle Supabase pour React
 *   Native, évite de rafraîchir inutilement en arrière-plan).
 */

function supabaseConfig(): { url: string; anonKey: string } {
  const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined;
  return { url: extra?.supabaseUrl ?? "", anonKey: extra?.supabaseAnonKey ?? "" };
}

const { url, anonKey } = supabaseConfig();

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Ne rafraîchit le token que quand l'app est réellement au premier plan —
// recommandation officielle Supabase pour React Native (évite un
// rafraîchissement silencieux et inutile en arrière-plan).
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
