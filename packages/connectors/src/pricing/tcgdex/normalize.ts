import type { NormalizedPriceObservation } from "../../types";
import type { TcgCatalogHints } from "../../catalogs/tcg/types";
import type { TcgdexCard } from "../../catalogs/tcgdex/raw-types";
import type { TcgdexLanguage } from "../../catalogs/tcgdex/normalize";

/** Cardmarket est un marché européen (EUR) — jamais assimilé à une valeur suisse. */
const EU_CARDMARKET_WARNING = "Prix Cardmarket en EUR (TCGdex) — n'est jamais automatiquement un prix de marché suisse (CHF).";
/** TCGPlayer est une référence nord-américaine (USD) — même avertissement que JustTCG. */
const NA_TCGPLAYER_WARNING =
  "Prix TCGPlayer en USD (TCGdex), référence nord-américaine — ne représente pas une valeur de marché suisse ou européenne.";

/** Clés de variante TCGPlayer documentées par TCGdex — jamais un enum figé côté source, juste un libellé lisible. */
const TCGPLAYER_VARIANT_LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  "reverse-holofoil": "Reverse Holofoil",
  "1st-edition": "1st Edition",
  "1st-edition-holofoil": "1st Edition Holofoil",
  unlimited: "Unlimited",
  "unlimited-holofoil": "Unlimited Holofoil",
};

/**
 * TCGdex identifie une langue par son code de locale ("en"/"fr"), mais le
 * reste du pipeline (indices d'origine, JustTCG) utilise le mot complet
 * ("English"/"French" — confirmé par les données réelles JustTCG, LOT 2).
 * Sans cette conversion, `classifyCrossMatch` (LOT 3) comparerait "English"
 * à "en" avec `sameText()` et échouerait toujours la corroboration de
 * langue, même quand les deux sources décrivent la même carte.
 */
const TCGDEX_LANGUAGE_LABELS: Record<TcgdexLanguage, string> = {
  en: "English",
  fr: "French",
};

function centsFromUnit(amount: number): number {
  return Math.round(amount * 100);
}

function toIso(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

interface TcgplayerVariantPrice {
  productId?: number;
  marketPrice?: number | null;
  midPrice?: number | null;
}

/**
 * Carte TCGdex → observations de prix normalisées. Cardmarket (EUR) et
 * TCGPlayer (USD) restent deux provenances distinctes, jamais moyennées ni
 * fusionnées — voir LOT 7B, règle "aucune moyenne arbitraire entre les
 * sources". Le prix Cardmarket utilisé est `trend` (prix de tendance,
 * même convention que `cardmarket.trendPrice` déjà utilisé pour les indices
 * tiers Pokémon TCG API, LOT 1).
 */
export function normalizeTcgdexPricing(card: TcgdexCard, hints: TcgCatalogHints, language: TcgdexLanguage): NormalizedPriceObservation[] {
  const observations: NormalizedPriceObservation[] = [];
  const pricing = card.pricing;
  if (!pricing) return observations;

  const requestedVariant = hints.extra?.variant ?? hints.extra?.printing;
  const wantsFoil = requestedVariant ? /holo|reverse/i.test(requestedVariant) : undefined;

  const cm = pricing.cardmarket;
  if (cm) {
    const updatedAt = toIso(cm.updated);
    const nonFoilPrice = cm.trend ?? null;
    const foilPrice = cm["trend-holo"] ?? null;

    if ((wantsFoil === undefined || wantsFoil === false) && nonFoilPrice !== null && nonFoilPrice !== undefined) {
      observations.push(buildCardmarketObservation(card, language, "Normal", nonFoilPrice, updatedAt));
    }
    if ((wantsFoil === undefined || wantsFoil === true) && foilPrice !== null && foilPrice !== undefined) {
      observations.push(buildCardmarketObservation(card, language, "Holofoil", foilPrice, updatedAt));
    }
  }

  const tp = pricing.tcgplayer;
  if (tp) {
    const updatedAt = toIso(tp.updated as string | number | undefined);
    const requestedKey = requestedVariant?.toLowerCase().replace(/\s+/g, "-");
    const variantEntries = Object.entries(tp).filter(
      (entry): entry is [string, TcgplayerVariantPrice] => entry[0] !== "updated" && entry[0] !== "unit" && typeof entry[1] === "object" && entry[1] !== null,
    );

    // Deux clés de variante partageant le même productId TCGPlayer signifient
    // que TCGdex reporte le même prix deux fois — jamais présenté comme deux
    // observations indépendantes sans avertissement (LOT 7B, "problème connu
    // de mapping vers la même fiche prix externe").
    const keysByProductId = new Map<number, string[]>();
    for (const [key, value] of variantEntries) {
      if (value.productId === undefined) continue;
      const keys = keysByProductId.get(value.productId) ?? [];
      keys.push(key);
      keysByProductId.set(value.productId, keys);
    }

    for (const [key, value] of variantEntries) {
      if (requestedKey && key !== requestedKey) continue;
      const amount = value.marketPrice ?? value.midPrice ?? null;
      if (amount === null || amount === undefined) continue;

      const sharedWith = value.productId !== undefined ? (keysByProductId.get(value.productId) ?? []).filter((k) => k !== key) : [];
      const warnings = [NA_TCGPLAYER_WARNING];
      if (sharedWith.length > 0) {
        warnings.push(
          `Prix partagé avec la variante "${sharedWith.join(", ")}" côté TCGPlayer (même productId ${value.productId}) — non vérifié indépendamment.`,
        );
      }

      observations.push({
        source: "tcgdex",
        externalProductId: `${card.id}:tcgplayer:${key}`,
        game: "Pokémon",
        name: card.name,
        setName: card.set.name,
        // `card.set.id` est un identifiant interne TCGdex, pas un code de set
        // comparable entre sources (ex. "base1" chez TCGdex = "base4" chez
        // Pokémon TCG API pour le même Base Set réel, confirmé par appel
        // réel) — jamais présenté comme un `setId` corroborable. Seul
        // `setName` (texte localisé, réellement comparable) l'est.
        setId: null,
        number: String(card.localId),
        variant: TCGPLAYER_VARIANT_LABELS[key] ?? key,
        language: TCGDEX_LANGUAGE_LABELS[language],
        condition: null,
        gradingCompany: null,
        grade: null,
        amountCents: centsFromUnit(amount),
        currency: "USD",
        priceType: "market_aggregate",
        updatedAt,
        region: "US",
        provenance: "tcgdex-tcgplayer",
        confidence: 1,
        warnings,
      });
    }
  }

  return observations;
}

function buildCardmarketObservation(
  card: TcgdexCard,
  language: TcgdexLanguage,
  variant: "Normal" | "Holofoil",
  price: number,
  updatedAt: string | null,
): NormalizedPriceObservation {
  return {
    source: "tcgdex",
    externalProductId: `${card.id}:cardmarket:${variant.toLowerCase()}`,
    game: "Pokémon",
    name: card.name,
    setName: card.set.name,
    // Voir la note ci-dessus (observation TCGPlayer) : id de set interne TCGdex, jamais comparable entre sources.
    setId: null,
    number: String(card.localId),
    variant,
    language: TCGDEX_LANGUAGE_LABELS[language],
    condition: null,
    gradingCompany: null,
    grade: null,
    amountCents: centsFromUnit(price),
    currency: "EUR",
    priceType: "market_aggregate",
    updatedAt,
    region: "EU",
    provenance: "tcgdex-cardmarket",
    confidence: 1,
    warnings: [EU_CARDMARKET_WARNING],
  };
}
