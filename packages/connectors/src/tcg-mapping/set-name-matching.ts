/**
 * Comparaison déterministe de noms de set entre fournisseurs (Pokémon TCG
 * API, TCGdex, JustTCG) — démontré nécessaire par deux cas réels : Pokémon
 * TCG API nomme un set "Base" quand TCGdex ET JustTCG nomment le même set
 * réel "Base Set" (confirmé par appels réels, LOT 7B/7C).
 *
 * Volontairement PAS une égalité brute (casse/accents/ponctuation diffèrent
 * légitimement selon la source), PAS un `contains()`, PAS une comparaison
 * par préfixe (ferait correspondre "Base Set" à "Base Set 2" à tort), et
 * JAMAIS de similarité approximative (Levenshtein, trigrammes, etc.).
 *
 * Seuls trois mécanismes contrôlés, dans cet ordre de priorité strict :
 *   1. Égalité après normalisation déterministe (casse, accents,
 *      ponctuation, espaces, séparateurs "&"/"and" unifiés).
 *   2. Retrait d'un suffixe générique explicitement autorisé (liste
 *      contrôlée ci-dessous — jamais un préfixe, jamais un mot porteur de
 *      sens).
 *   3. Alias explicite vérifié (exceptions connues, jamais une règle
 *      générale).
 * Si aucun des trois ne produit de correspondance, refus — jamais un choix
 * arbitraire.
 *
 * Partagé entre `@dealradar/ingestion` (corroboration catalogue↔catalogue,
 * `corroborate-catalog-identity.ts`) et ce paquet (corroboration
 * catalogue↔pricing, `pokemon-to-justtcg.ts`) — même règle, une seule
 * implémentation, jamais dupliquée.
 */

export interface SetNameMatchResult {
  matched: boolean;
  reason: string;
}

/**
 * Suffixes génériques dont le retrait est explicitement autorisé — liste
 * contrôlée, à étendre uniquement avec une justification écrite comme
 * celle-ci. "set" : couvre "Base" ↔ "Base Set" (démontré par test réel,
 * LOT 7B/7C) sans jamais confondre "Base Set" et "Base Set 2" (le suffixe
 * n'est retiré que s'il est le tout dernier mot).
 */
const GENERIC_SET_NAME_SUFFIXES: readonly string[] = ["set"];

/**
 * Alias explicites pour des exceptions connues et vérifiées individuellement
 * — jamais une règle générale ni une commodité. Vide pour l'instant : aucune
 * exception n'a encore été démontrée au-delà de ce que couvrent la
 * normalisation et le retrait de suffixe. À peupler uniquement quand un cas
 * réel l'exige, avec la justification en commentaire à côté de l'entrée.
 */
const SET_NAME_ALIASES: Readonly<Record<string, string>> = {};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Casse, accents, ponctuation → espace, séparateurs "&"/"and" unifiés en "and", espaces multiples réduits. */
function normalizeSetNameToken(raw: string): string {
  let value = stripDiacritics(raw.toLowerCase());
  value = value.replace(/&/g, " and ");
  value = value.replace(/[^a-z0-9]+/g, " ");
  return value.replace(/\s+/g, " ").trim();
}

/** Ne retire le suffixe que s'il est le tout dernier mot — jamais une correspondance partielle en milieu de nom. */
function stripAllowedSuffix(normalized: string): string | null {
  const words = normalized.split(" ");
  const last = words[words.length - 1];
  if (words.length > 1 && last && GENERIC_SET_NAME_SUFFIXES.includes(last)) {
    return words.slice(0, -1).join(" ");
  }
  return null;
}

export function setNamesMatch(providerAName: string, providerBName: string): SetNameMatchResult {
  const rawA = normalizeSetNameToken(providerAName);
  const rawB = normalizeSetNameToken(providerBName);

  if (rawA === rawB) {
    return { matched: true, reason: `Formes normalisées identiques ("${rawA}").` };
  }

  const strippedA = stripAllowedSuffix(rawA);
  const strippedB = stripAllowedSuffix(rawB);
  if ((strippedA ?? rawA) === rawB || rawA === (strippedB ?? rawB) || (strippedA !== null && strippedA === strippedB)) {
    return {
      matched: true,
      reason: `Équivalents après retrait d'un suffixe générique autorisé ("${providerAName}" / "${providerBName}").`,
    };
  }

  const aliasA = SET_NAME_ALIASES[rawA];
  const aliasB = SET_NAME_ALIASES[rawB];
  if ((aliasA ?? rawA) === (aliasB ?? rawB) && (aliasA !== undefined || aliasB !== undefined)) {
    return { matched: true, reason: `Équivalents via un alias explicite vérifié.` };
  }

  return {
    matched: false,
    reason: `Aucune correspondance déterministe entre "${providerAName}" et "${providerBName}".`,
  };
}
