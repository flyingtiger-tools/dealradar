/**
 * Génération déterministe de requêtes de recherche (LOT "Universal Object
 * Valuation Foundation") — traduit un résultat d'identification (brand/
 * model/variant/identifiants) en une requête texte "exacte" (la plus
 * spécifique possible) et une liste de replis progressivement relâchés, à
 * utiliser contre `MarketplaceConnector.search()`
 * (`packages/connectors/src/types.ts`) quand la requête la plus précise ne
 * remonte rien. Fonction pure, aucune I/O — ne connaît aucun connecteur.
 *
 * Règle absolue testée : un champ manquant ne doit JAMAIS produire de
 * requête invalide ("undefined", espaces multiples/en bordure) — il est
 * simplement omis, jamais remplacé par une valeur inventée.
 */

export interface SearchQueryInput {
  /** Marque — ex. "Nike", "Rolex", "Apple". */
  brand?: string | null;
  /** Modèle/nom de produit — ex. "Air Jordan 1 Retro High", "Submariner", "iPhone 13". */
  model?: string | null;
  /** Variante/édition — ex. "Chicago", "Black Dial", "Millennium Falcon". */
  variant?: string | null;
  /**
   * Identifiants complémentaires utiles à la requête (taille, capacité,
   * référence, spec technique...), ordre = priorité décroissante — le
   * premier est le plus discriminant. Jamais fabriqués : uniquement ceux
   * réellement observés par l'extraction.
   */
  identifiers?: (string | null | undefined)[];
  /**
   * Repli de dernier recours si brand/model sont tous deux absents (ex. le
   * titre brut fourni par l'utilisateur) — jamais utilisé s'il existe déjà
   * un brand ou un model.
   */
  titleFallback?: string | null;
}

export interface SearchQueries {
  /** Requête la plus spécifique possible à partir des champs fournis — chaîne vide si rien d'exploitable n'est disponible. */
  exact: string;
  /**
   * Requêtes progressivement relâchées, de la plus proche de `exact` à la
   * plus large — jamais un doublon entre elles ni avec `exact`, jamais une
   * chaîne vide dans cette liste.
   */
  fallbacks: string[];
}

/** Nettoie un champ texte : trim, espaces internes réduits à un seul — jamais `undefined`/`null` ne fuite dans une requête. */
function cleanToken(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function joinTokens(tokens: (string | null)[]): string {
  return tokens.filter((t): t is string => t !== null).join(" ").trim();
}

/**
 * Construit la requête "exacte" (tous les champs disponibles) puis une
 * série de replis en retirant, dans l'ordre, les identifiants
 * complémentaires puis la variante — l'ancre `brand + model` (la plus
 * discriminante) est conservée le plus longtemps possible. Si `brand`/
 * `model` sont tous deux absents, replie sur `variant` puis
 * `titleFallback` seuls. Déduplique et retire toute entrée vide avant de
 * retourner.
 */
export function buildSearchQueries(input: SearchQueryInput): SearchQueries {
  const brand = cleanToken(input.brand);
  const model = cleanToken(input.model);
  const variant = cleanToken(input.variant);
  const identifiers = (input.identifiers ?? []).map(cleanToken).filter((v): v is string => v !== null);
  const titleFallback = cleanToken(input.titleFallback);

  const hasAnchor = brand !== null || model !== null;

  const candidates: string[] = [];
  if (hasAnchor) {
    candidates.push(joinTokens([brand, model, variant, ...identifiers]));
    if (identifiers.length > 0) candidates.push(joinTokens([brand, model, variant]));
    if (variant !== null) candidates.push(joinTokens([brand, model]));
    if (brand !== null && model !== null) candidates.push(model);
  } else {
    if (variant !== null) candidates.push(variant);
    if (titleFallback !== null) candidates.push(titleFallback);
  }

  // Déduplique en conservant l'ordre (le premier = le plus spécifique = `exact`), retire les entrées vides.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const candidate of candidates) {
    if (candidate.length === 0 || seen.has(candidate)) continue;
    seen.add(candidate);
    ordered.push(candidate);
  }

  const [exact, ...fallbacks] = ordered;
  return { exact: exact ?? "", fallbacks };
}
