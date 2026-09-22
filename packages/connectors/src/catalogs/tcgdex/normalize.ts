import type { CatalogItem, CatalogMatch, ThirdPartyPriceHint } from "../../types";
import type { TcgCatalogHints } from "../tcg/types";
import type { TcgdexCard } from "./raw-types";
import { setNamesMatch } from "../../tcg-mapping/set-name-matching";

/**
 * `pricing.updated` est une chaîne ISO dans TOUS les échantillons réels
 * capturés (`__tests__/fixtures/cards.ts`) — le schéma l'autorise aussi en
 * nombre (`z.union([z.string(), z.number()])`) par prudence défensive
 * uniquement, jamais confirmé par un appel réel. Un nombre est interprété
 * comme une epoch Unix (secondes si < 10^12, sinon millisecondes) — jamais
 * une valeur inventée si la conversion échoue (`null`).
 */
function toIsoStringOrNull(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  const ms = value < 1_000_000_000_000 ? value * 1000 : value;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isTcgplayerVariantPrice(value: unknown): value is { lowPrice?: number | null; midPrice?: number | null; highPrice?: number | null; marketPrice?: number | null } {
  return typeof value === "object" && value !== null;
}

/**
 * Agrégats de prix tiers Cardmarket/TCGplayer DÉJÀ récupérés par le schéma
 * (`raw-types.ts`) mais jamais exposés avant ce lot (LOT "Free/Open
 * Sources + Real Readiness + Live Smoke Tests", section 2 — trouvaille :
 * `pricing` était analysé puis silencieusement jeté, disponible seulement
 * dans le blob `raw` opaque) — même contrat `ThirdPartyPriceHint` que
 * `catalogs/pokemon-tcg/normalize.ts` (`provenance: "listing_aggregate"`,
 * JAMAIS une vente confirmée individuelle). Cardmarket "holo" est un OBJET
 * SÉPARÉ côté TCGdex (clés `avg-holo`/`low-holo`/`trend-holo` dans le MÊME
 * objet que le prix non-holo, jamais un second objet `pricing.cardmarket`) —
 * ajouté comme un second `ThirdPartyPriceHint` avec `variant: "holo"`
 * UNIQUEMENT si au moins un de ces trois champs est renseigné (jamais les
 * trois exigés ensemble, voir PIKACHU_BASE1_EN : `avg-holo`/`low-holo`
 * `null` mais `trend-holo` renseigné).
 */
function extractTcgdexPriceHints(raw: TcgdexCard): ThirdPartyPriceHint[] {
  const hints: ThirdPartyPriceHint[] = [];
  const pricing = raw.pricing;
  if (!pricing) return hints;

  const cardmarket = pricing.cardmarket;
  if (cardmarket) {
    const currency = cardmarket.unit ?? "EUR";
    const observedAt = toIsoStringOrNull(cardmarket.updated);
    hints.push({
      source: "cardmarket",
      variant: null,
      priceLow: cardmarket.low ?? null,
      priceMid: cardmarket.trend ?? null,
      priceHigh: cardmarket.avg ?? null,
      currency,
      observedAt,
      provenance: "listing_aggregate",
    });
    const holoLow = cardmarket["low-holo"] ?? null;
    const holoTrend = cardmarket["trend-holo"] ?? null;
    const holoAvg = cardmarket["avg-holo"] ?? null;
    if (holoLow !== null || holoTrend !== null || holoAvg !== null) {
      hints.push({
        source: "cardmarket",
        variant: "holo",
        priceLow: holoLow,
        priceMid: holoTrend,
        priceHigh: holoAvg,
        currency,
        observedAt,
        provenance: "listing_aggregate",
      });
    }
  }

  const tcgplayer = pricing.tcgplayer;
  if (tcgplayer) {
    const currency = typeof tcgplayer.unit === "string" ? tcgplayer.unit : "USD";
    const observedAt = toIsoStringOrNull(typeof tcgplayer.updated === "string" || typeof tcgplayer.updated === "number" ? tcgplayer.updated : undefined);
    for (const [variant, value] of Object.entries(tcgplayer)) {
      if (variant === "updated" || variant === "unit") continue;
      if (!isTcgplayerVariantPrice(value)) continue;
      hints.push({
        source: "tcgplayer",
        variant,
        priceLow: value.lowPrice ?? null,
        priceMid: value.midPrice ?? value.marketPrice ?? null,
        priceHigh: value.highPrice ?? null,
        currency,
        observedAt,
        provenance: "listing_aggregate",
      });
    }
  }

  return hints;
}

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
  // Variantes RÉELLEMENT possédées par cette impression (LOT "Free/Open
  // Sources...", section 2) — jamais un enum figé, TCGdex les modélise en
  // booléens indépendants (`normal`/`reverse`/`holo`/`firstEdition`/
  // `wPromo`) ; sérialisé en liste de clés vraies uniquement, même
  // convention que `variants` côté Pokémon TCG API
  // (`catalogs/pokemon-tcg/normalize.ts`, joint par virgule).
  const trueVariants = raw.variants ? Object.entries(raw.variants).filter(([, present]) => present === true).map(([name]) => name) : [];

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
      illustrator: raw.illustrator ?? null,
      variants: trueVariants.length > 0 ? trueVariants.join(",") : null,
    },
    images: raw.image ? [raw.image] : [],
    externalUrl: null,
    priceHints: extractTcgdexPriceHints(raw),
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
