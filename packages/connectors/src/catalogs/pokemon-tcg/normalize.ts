import type { CatalogItem, CatalogMatch, ThirdPartyPriceHint } from "../../types";
import type { TcgCatalogHints } from "../tcg/types";
import type { PokemonTcgRawCard } from "./raw-types";

/**
 * Prix tiers TCGPlayer (une entrée par variante — "holofoil", "1stEditionHolofoil"…)
 * et Cardmarket (agrégé, pas de variante) — jamais une vente confirmée, voir
 * `ThirdPartyPriceHint`. Absents si l'API ne les fournit pas pour cette carte.
 */
function extractPriceHints(raw: PokemonTcgRawCard): ThirdPartyPriceHint[] {
  const hints: ThirdPartyPriceHint[] = [];

  if (raw.tcgplayer?.prices) {
    for (const [variant, tier] of Object.entries(raw.tcgplayer.prices)) {
      hints.push({
        source: "tcgplayer",
        variant,
        priceLow: tier.low ?? null,
        priceMid: tier.mid ?? null,
        priceHigh: tier.high ?? null,
        currency: "USD",
        observedAt: raw.tcgplayer.updatedAt ?? null,
        provenance: "listing_aggregate",
      });
    }
  }

  if (raw.cardmarket?.prices) {
    const p = raw.cardmarket.prices;
    hints.push({
      source: "cardmarket",
      variant: null,
      priceLow: p.lowPrice ?? null,
      priceMid: p.trendPrice ?? null,
      priceHigh: p.averageSellPrice ?? null,
      currency: "EUR",
      observedAt: raw.cardmarket.updatedAt ?? null,
      provenance: "listing_aggregate",
    });
  }

  return hints;
}

/**
 * Carte brute → `CatalogItem`. Le `kind` retourné est toujours `"raw_card"` :
 * l'API ne connaît que l'identité de l'impression elle-même, jamais l'état
 * gradé d'un exemplaire précis (voir `resolve()` dans connector.ts pour la
 * règle de refus honnête sur les kinds gradés/scellés).
 */
export function normalizePokemonTcgCard(raw: PokemonTcgRawCard, categorySlug: string): CatalogItem {
  const variants = raw.tcgplayer?.prices ? Object.keys(raw.tcgplayer.prices) : [];

  return {
    source: "pokemon-tcg-api",
    externalId: raw.id,
    kind: "raw_card",
    categorySlug,
    name: raw.name,
    canonicalAttributes: {
      setId: raw.set.id,
      setName: raw.set.name,
      setSeries: raw.set.series ?? null,
      setReleaseDate: raw.set.releaseDate ?? null,
      collectorNumber: raw.number,
      rarity: raw.rarity ?? null,
      supertype: raw.supertype ?? null,
      variants: variants.length > 0 ? variants.join(",") : null,
    },
    images: [raw.images?.large, raw.images?.small].filter((url): url is string => Boolean(url)),
    externalUrl: null,
    priceHints: extractPriceHints(raw),
    raw,
  };
}

/**
 * Score de confiance honnête : proportion des indices *fournis* qui matchent
 * réellement la carte candidate — jamais une estimation devinée. Sans indice
 * fourni au-delà du nom (qui a déjà servi à la recherche), la confiance reste
 * modérée par construction (voir le plancher `NAME_ONLY_CONFIDENCE`).
 */
const NAME_ONLY_CONFIDENCE = 0.5;

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

export function matchCard(raw: PokemonTcgRawCard, hints: TcgCatalogHints): CatalogMatch {
  const matchedOn: string[] = [];
  let comparableHints = 0;

  if (hints.name) {
    comparableHints += 1;
    if (normalizeForCompare(raw.name) === normalizeForCompare(hints.name)) matchedOn.push("name");
  }
  if (hints.setName) {
    comparableHints += 1;
    if (normalizeForCompare(raw.set.name) === normalizeForCompare(hints.setName)) matchedOn.push("setName");
  }
  if (hints.setCode) {
    comparableHints += 1;
    if (normalizeForCompare(raw.set.id) === normalizeForCompare(hints.setCode)) matchedOn.push("setCode");
  }
  if (hints.collectorNumber) {
    comparableHints += 1;
    if (normalizeForCompare(raw.number) === normalizeForCompare(hints.collectorNumber)) matchedOn.push("collectorNumber");
  }

  // Le nom seul a déjà servi de filtre côté API — matcher dessus seul ne suffit
  // jamais à une confiance totale (des dizaines de cartes partagent un même nom
  // à travers les extensions). Un indice corroborant (set, numéro) est requis
  // pour dépasser ce plancher.
  const onlyNameProvided = comparableHints === 1 && matchedOn.length === 1 && matchedOn[0] === "name";
  const confidence =
    comparableHints === 0 || onlyNameProvided ? NAME_ONLY_CONFIDENCE : matchedOn.length / comparableHints;

  return { item: normalizePokemonTcgCard(raw, "pokemon_tcg"), confidence, matchedOn };
}
