/**
 * Extrait `sub` (l'identifiant utilisateur Supabase) du payload d'un jeton
 * JWT — décodage seul, jamais une vérification de signature (l'ergonomie
 * client uniquement : construire le bon chemin Storage sans champ de
 * saisie supplémentaire). La sécurité réelle vient de la RLS côté serveur,
 * qui revérifie le jeton indépendamment — un `sub` mal extrait ici ferait
 * simplement échouer l'upload (RLS), jamais un contournement de sécurité.
 */
export function decodeJwtUserId(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadBase64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);
    const decoded = atob(padded);
    const payload = JSON.parse(decoded) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
