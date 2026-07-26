/**
 * Incrémenté à chaque modification du texte du prompt — entre dans la clé
 * de cache (une modification invalide silencieusement les entrées existantes).
 */
export const PROMPT_VERSION = 1;

const SYSTEM_PROMPT = `Tu es un extracteur de données produit pour un marketplace de seconde main.
Ta seule tâche est d'extraire des faits structurés à partir du titre, de la description et des photos fournis.

Règles strictes :
- N'exprime JAMAIS d'avis sur si l'annonce est une bonne affaire, un bon prix, ou si l'utilisateur devrait l'acheter.
- Ne donne aucune recommandation d'achat, de vente, ou d'attente.
- Ne calcule aucun score, aucune estimation de valeur ou de profit.
- Si une information n'est pas visible ou certaine, retourne null pour ce champ plutôt qu'une supposition.
- Réponds uniquement avec un objet JSON respectant strictement le schéma fourni, sans texte autour.
- Pour chaque champ non nul, fournis une confiance entre 0 et 1 reflétant ta certitude.
- Ne retranscris jamais un numéro de série complet : indique seulement s'il est détectable (booléen).`;

/** Redacte tout motif ressemblant à un numéro de série avant de construire le prompt — le provider ne reçoit jamais un numéro complet (correction 4). */
export function redactSerialNumberMentions(text: string): string {
  return text
    .replace(/\bserial\s*(number|no\.?|#)?\s*[:#]?\s*[a-z0-9-]{5,}/gi, "[numéro de série masqué]")
    .replace(/\bnum[ée]ro de s[ée]rie\s*[:#]?\s*[a-z0-9-]{3,}/gi, "[numéro de série masqué]");
}

export interface PromptContent {
  system: string;
  userText: string;
}

export function buildPrompt(input: { title: string; description?: string | null; categorySlug: string }): PromptContent {
  const safeTitle = redactSerialNumberMentions(input.title);
  const safeDescription = redactSerialNumberMentions(input.description ?? "");

  const userText = [
    `Catégorie : ${input.categorySlug}`,
    `Titre : ${safeTitle}`,
    safeDescription ? `Description : ${safeDescription}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { system: SYSTEM_PROMPT, userText };
}

/** Mots-clés de jugement de valeur — utilisé uniquement par le test statique du prompt. */
export const FORBIDDEN_JUDGMENT_KEYWORDS = [
  "bonne affaire",
  "good deal",
  "devrait acheter",
  "should buy",
  "recommand",
  "worth it",
  "vaut le coup",
];
