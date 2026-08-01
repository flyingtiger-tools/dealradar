import type { CatalogItem, CatalogMatch } from "../../types";
import type { TcgCatalogHints } from "../tcg/types";
import type { TcgdexCard } from "./raw-types";
import { setNamesMatch } from "../../tcg-mapping/set-name-matching";

/**
 * TCGdex expose un catalogue multilingue — la langue interrogée détermine
 * quelle locale de l'API a répondu (`name`/`rarity`/`set.name` localisés),
 * jamais devinée depuis la réponse elle-même. Limitée à FR/EN pour ce lot,
 * conformément à la demande ; TCGdex en couvre davantage.
 */
export const SUPPORTED_TCGDEX_LANGUAGES = ["en", "fr"] as const;
export type TcgdexLanguage = (typeof SUPPORTED_TCGDEX_LANGUAGES)[number];

export function resolveTcgdexLanguage(hintsLanguage: string | undefined): TcgdexLanguage {
  if (!hintsLanguage) return "en";
  const normalized = hintsLanguage.trim().toLowerCase();
  if (normalized === "fr" || normalized === "french" || normalized === "français" || normalized === "francais") return "fr";
  return "en";
}

export function normalizeTcgdexCard(raw: TcgdexCard, categorySlug: string, language: TcgdexLanguage): CatalogItem {
  return {
    source: "tcgdex",
    externalId: raw.id,
    kind: "raw_card",
    categorySlug,
    name: raw.name,
    canonicalAttributes: {
      setId: raw.set.id,
      setName: raw.set.name,
      collectorNumber: String(raw.localId),
      rarity: raw.rarity ?? null,
      category: raw.category,
      language,
    },
    images: raw.image ? [raw.image] : [],
    externalUrl: null,
    raw,
  };
}

/**
 * Score de confiance honnête — même discipline que
 * `catalogs/pokemon-tcg/normalize.ts` : le nom seul ne suffit jamais à une
 * confiance totale. La langue est un indice corroborant comme les autres —
 * jamais une équivalence silencieuse entre locales.
 */
const NAME_ONLY_CONFIDENCE = 0.5;

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

export function matchTcgdexCard(raw: TcgdexCard, hints: TcgCatalogHints, language: TcgdexLanguage): CatalogMatch {
  const matchedOn: string[] = [];
  let comparableHints = 0;

  if (hints.name) {
    comparableHints += 1;
    if (normalizeForCompare(raw.name) === normalizeForCompare(hints.name)) matchedOn.push("name");
  }
  if (hints.setName) {
    comparableHints += 1;
    // Jamais une égalité brute : Pokémon TCG API nomme ce set "Base" quand
    // TCGdex le nomme "Base Set" — même principe déjà appliqué en pricing
    // (LOT 7C, `set-name-matching.ts`). Une égalité brute laissait ce set
    // non crédité, ce qui désactivait le filtre de set côté JustTCG en aval
    // (repli `single_catalog_source`) et produisait de faux candidats
    // d'autres sets partageant le même numéro (démontré par test réel).
    if (setNamesMatch(hints.setName, raw.set.name).matched) matchedOn.push("setName");
  }
  // `hints.setCode` n'est jamais comparé à `raw.set.id` : cet id est interne
  // à TCGdex, pas un code de set comparable entre catalogues (confirmé par
  // appel réel — "base4" chez Pokémon TCG API et "base1" chez TCGdex
  // désignent des sets différents). Voir aussi la règle validée LOT 7B
  // "aucune comparaison des IDs de sets entre fournisseurs" — seul
  // `setName` (texte localisé) corrobore le set ici.
  if (hints.collectorNumber) {
    comparableHints += 1;
    if (normalizeForCompare(String(raw.localId)) === normalizeForCompare(hints.collectorNumber)) matchedOn.push("collectorNumber");
  }
  if (hints.language) {
    comparableHints += 1;
    if (resolveTcgdexLanguage(hints.language) === language) matchedOn.push("language");
  }

  const onlyNameProvided = comparableHints === 1 && matchedOn.length === 1 && matchedOn[0] === "name";
  const confidence = comparableHints === 0 || onlyNameProvided ? NAME_ONLY_CONFIDENCE : matchedOn.length / comparableHints;

  return { item: normalizeTcgdexCard(raw, "pokemon_tcg", language), confidence, matchedOn };
}
