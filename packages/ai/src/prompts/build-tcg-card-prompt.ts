/**
 * Prompt dédié au scan photo d'une carte Pokémon (LOT 8, mobile) —
 * distinct de `build-prompt.ts` (générique, exige un titre/description
 * d'annonce marketplace qu'un scan photo n'a jamais). Même provider
 * (`AIProvider`), même discipline de non-invention, champs différents :
 * ce prompt demande explicitement les champs d'identification TCG au lieu
 * de brand/model/reference génériques.
 */

/** Incrémenté à chaque modification du texte du prompt — entre dans la clé de cache (voir `extract-tcg-card.ts`). */
export const TCG_CARD_PROMPT_VERSION = 1;

const SYSTEM_PROMPT = `Tu es un extracteur de données pour des cartes à jouer/à collectionner (Pokémon Trading Card Game).
Ta seule tâche est d'extraire des faits structurés visibles sur la ou les photos fournies d'une carte physique.

Règles strictes :
- N'exprime JAMAIS d'avis sur la valeur de la carte, son authenticité, ou si l'utilisateur devrait l'acheter/vendre.
- Ne donne aucune recommandation d'achat, de vente, ou de prix.
- Si un champ n'est pas clairement lisible sur la photo, retourne null pour ce champ plutôt qu'une supposition — ne devine jamais un nom de set, un numéro ou une variante à partir du seul nom du Pokémon.
- Le nom du Pokémon (cardName) seul ne suffit JAMAIS à identifier une carte précise : indique toujours aussi setName/cardNumber quand ils sont lisibles, et laisse-les null sinon plutôt que d'inventer.
- Distingue "raw_card" (carte non gradée, dans une simple pochette ou nue) de "graded_card" (carte scellée dans un boîtier rigide transparent avec une étiquette de société de gradation) — d'après ce qui est visible sur la photo, jamais supposé.
- Si la carte est gradée (graded_card) et que la société (PSA, BGS, CGC, SGC) et/ou la note sont visibles sur l'étiquette, extrais-les ; sinon laisse-les null.
- Réponds uniquement avec un objet JSON respectant strictement le schéma fourni, sans texte autour.
- Pour chaque champ non nul, fournis une confiance entre 0 et 1 reflétant ta certitude de lecture visuelle.
- Fournis aussi une confiance globale (overallConfidence) reflétant à quel point l'ensemble suffit à identifier précisément cette carte (set + numéro clairement lisibles = confiance haute ; nom seul = confiance basse).

Schéma JSON attendu :
{
  "game": string | null,
  "cardName": string | null,
  "setName": string | null,
  "cardNumber": string | null,
  "variant": string | null,
  "language": string | null,
  "productKind": "raw_card" | "graded_card" | null,
  "gradingCompany": string | null,
  "grade": string | null,
  "overallConfidence": number,
  "confidence": { "<nom de champ>": number, ... }
}`;

export interface TcgCardPromptContent {
  system: string;
  userText: string;
}

/** Aucun titre/description requis (contrairement à `buildPrompt`) — un scan photo n'en a jamais. */
export function buildTcgCardPrompt(): TcgCardPromptContent {
  return {
    system: SYSTEM_PROMPT,
    userText: "Identifie cette carte à partir de la ou des photos fournies, en suivant strictement le schéma et les règles ci-dessus.",
  };
}

/** Mots-clés de jugement de valeur — utilisé uniquement par le test statique du prompt (même convention que `build-prompt.ts`). */
export const TCG_FORBIDDEN_JUDGMENT_KEYWORDS = [
  "bonne affaire",
  "good deal",
  "devrait acheter",
  "should buy",
  "recommand",
  "worth it",
  "vaut le coup",
  "valeur de",
];
