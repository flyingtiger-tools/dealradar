import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Stockage local du drapeau "onboarding déjà vu" (LOT "beta product
 * readiness", Phase 30) — `AsyncStorage` (déjà une dépendance du projet,
 * déjà utilisée pour la session Supabase — voir `lib/supabase-client.ts`
 * — jamais un mécanisme de stockage supplémentaire ajouté pour un simple
 * booléen). Ne touche jamais `auth/session.ts` : ce module est
 * entièrement indépendant de la session, l'app décide séparément "y a-t-
 * il une session ?" et "l'onboarding a-t-il déjà été vu ?".
 */
const ONBOARDING_COMPLETED_KEY = "dealradar.onboardingCompleted";

/** `null` si jamais lu avec succès (première ouverture, ou stockage indisponible) — jamais un throw : un onboarding qui ne peut pas être lu doit se comporter comme "pas encore vu", jamais bloquer l'app. */
export async function isOnboardingCompleted(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

export async function setOnboardingCompleted(completed: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, completed ? "true" : "false");
  } catch {
    // Best-effort — un échec d'écriture ne doit jamais bloquer la navigation vers Home (voir App.tsx).
  }
}

/** Utilisé uniquement par Internal Tools -> "Reset onboarding" (Phase 31) — jamais exposé en UI consommateur normale. */
export async function resetOnboarding(): Promise<void> {
  await setOnboardingCompleted(false);
}
