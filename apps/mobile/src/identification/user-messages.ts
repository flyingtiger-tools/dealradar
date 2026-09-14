/**
 * Traduit les messages techniques internes (erreurs réseau brutes, codes de
 * statut backend, `reason` du pipeline) en texte lisible par l'utilisateur —
 * partagé par `TcgScanScreen.tsx` et `UniversalCaptureBetaScreen.tsx`.
 *
 * Règle : jamais `pokemon_tcg`, `status: failed`, `Network request failed`,
 * une pile d'erreur, ou un message brut de provider affichés tels quels à
 * l'écran — ces détails restent dans les logs uniquement (déjà le cas côté
 * worker, voir `process-tcg-card-analysis.ts`). Ce module ne masque jamais
 * une vraie cause : il choisit seulement la formulation, jamais une fausse
 * explication ni une donnée inventée.
 */

/** Motifs reconnus dans un message technique brut → texte utilisateur. Ordre = priorité (premier motif qui matche gagne). */
const KNOWN_PATTERNS: { test: (raw: string) => boolean; message: string }[] = [
  {
    test: (raw) => /network request failed/i.test(raw),
    message: "Impossible de joindre le service — vérifie ta connexion et réessaie.",
  },
  {
    test: (raw) => /d[ée]lai d[ée]pass[ée]/i.test(raw),
    message: "Le service met plus de temps que prévu à répondre — réessaie dans un instant.",
  },
  {
    test: (raw) => /aucune session active/i.test(raw),
    message: "Session expirée — reconnecte-toi puis réessaie.",
  },
  {
    test: (raw) => /configuration supabase manquante/i.test(raw),
    message: "Configuration de l'application incomplète — contacte le support.",
  },
  {
    test: (raw) => /aucune source de pricing/i.test(raw),
    message: "Carte identifiée, mais aucun prix disponible pour le moment.",
  },
  {
    test: (raw) => /catalogue principal.*indisponible|aucune carte catalogue r[ée]solue/i.test(raw),
    message: "Impossible d'identifier cette carte avec la photo fournie — réessaie avec une photo plus nette.",
  },
  {
    test: (raw) => /extraction visuelle non configur[ée]e|ia absente/i.test(raw),
    message: "L'identification automatique n'est pas disponible pour le moment.",
  },
  {
    test: (raw) => /photo introuvable|image indisponible/i.test(raw),
    message: "La photo n'a pas pu être traitée — reprends une nouvelle photo.",
  },
];

/**
 * Nettoie un message d'erreur/raison technique. Retourne `null` si l'entrée
 * est `null`/vide (jamais une chaîne inventée) ; sinon un message motif-
 * matché, ou — si rien ne correspond — un texte générique honnête plutôt que
 * d'exposer la chaîne technique brute telle quelle.
 */
export function cleanUserMessage(raw: string | null | undefined): string | null {
  if (!raw || raw.trim().length === 0) return null;
  for (const pattern of KNOWN_PATTERNS) {
    if (pattern.test(raw)) return pattern.message;
  }
  return "Une erreur est survenue — réessaie dans un instant.";
}
