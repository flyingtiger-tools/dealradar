import Constants from "expo-constants";

/**
 * Vérification de disponibilité backend (LOT "beta product readiness",
 * Phase 34) — AUCUN appel IA, aucune analyse déclenchée : une simple
 * requête vers la racine du domaine de l'API (page d'accueil Next.js),
 * qui prouve déjà DNS + TLS + serveur actif sans jamais toucher au
 * pipeline Groq/TCGdex/pricing. Aucune route `/api/health` dédiée
 * n'existe dans ce repo (vérifié) — plutôt que d'en créer une nouvelle
 * (hors périmètre de ce lot, centré sur le mobile), cette fonction
 * réutilise ce qui existe déjà : n'importe quelle réponse HTTP < 500
 * suffit à prouver que le serveur répond, peu importe le code exact.
 */
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

function apiBaseUrl(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:3000";
}

export async function checkBackendReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(apiBaseUrl(), { method: "GET", signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Domaine seul (jamais le chemin complet, jamais une clé) — Phase 33 : "API base URL domain uniquement". */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
