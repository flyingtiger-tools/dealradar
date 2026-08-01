import type { NormalizedPriceObservation } from "../../types";
import type { TcgCatalogHints } from "../../catalogs/tcg/types";
import type { JustTcgRawCard, JustTcgRawVariant, JustTcgRawMarket } from "./raw-types";
import { setNamesMatch } from "../../tcg-mapping/set-name-matching";
import { collectorNumbersMatch } from "../../tcg-mapping/collector-number-matching";

/**
 * JustTCG ne dessert aujourd'hui que la région NA/US (confirmé dans le code
 * source du SDK officiel — `V2_SERVICEABLE_REGIONS = ['NA', 'US']`). Cet
 * avertissement est donc attaché systématiquement : aucun prix JustTCG ne
 * doit jamais être lu comme une valeur de marché suisse ou européenne.
 */
const NORTH_AMERICA_WARNING =
  "Prix en USD, marché nord-américain (JustTCG) — ne représente pas une valeur de marché suisse ou européenne.";

const AMBIGUOUS_MATCH_WARNING =
  "Correspondance ambiguë : plusieurs cartes ou variantes possibles pour les indices fournis, confiance réduite.";

const NAME_ONLY_CONFIDENCE = 0.5;

function normalizeForCompare(value: string): string {
  return value.trim().toLowerCase();
}

function centsFromDollars(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Score de confiance honnête — même logique que
 * `catalogs/pokemon-tcg/normalize.ts` (le nom seul, déjà utilisé pour
 * filtrer côté API, ne suffit jamais à une confiance totale).
 *
 * `setName` utilise `setNamesMatch` (normalisation déterministe, jamais une
 * égalité brute) : Pokémon TCG API nomme un set "Base" quand JustTCG nomme
 * le même set réel "Base Set" (confirmé par appel réel, LOT 7C).
 * `collectorNumber` utilise `collectorNumbersMatch` pour la même raison :
 * JustTCG renvoie "058/102" (zéro de tête + dénominateur) là où le
 * catalogue renvoie "58". Aucun `setCode`/id de set n'est comparé ici :
 * l'id interne JustTCG ("base-set-pokemon") n'est jamais comparable à
 * celui d'un autre fournisseur (même principe déjà appliqué à TCGdex).
 */
function scoreMatch(card: JustTcgRawCard, variant: JustTcgRawVariant, hints: TcgCatalogHints): { confidence: number; matchedOn: string[] } {
  const matchedOn: string[] = [];
  let comparableHints = 0;

  if (hints.name) {
    comparableHints += 1;
    if (normalizeForCompare(card.name) === normalizeForCompare(hints.name)) matchedOn.push("name");
  }
  if (hints.setName) {
    comparableHints += 1;
    if (card.set.name && setNamesMatch(hints.setName, card.set.name).matched) matchedOn.push("setName");
  }
  if (hints.collectorNumber) {
    comparableHints += 1;
    if (collectorNumbersMatch(hints.collectorNumber, card.number)) matchedOn.push("collectorNumber");
  }

  // La variante/condition n'entre jamais dans le ratio de confiance générique :
  // un désaccord ici exclut déjà la variante en amont (voir buildCandidateVariants),
  // donc si on l'atteint ici, elle correspond par construction.
  if (variant.condition) matchedOn.push("condition:" + variant.condition);

  const onlyNameProvided = comparableHints === 1 && matchedOn.filter((m) => !m.startsWith("condition:")).length === 1 && matchedOn.includes("name");
  const nonConditionMatches = matchedOn.filter((m) => !m.startsWith("condition:")).length;
  const confidence =
    comparableHints === 0 || onlyNameProvided ? NAME_ONLY_CONFIDENCE : nonConditionMatches / comparableHints;

  return { confidence, matchedOn };
}

/**
 * Filtre les variantes candidates selon les indices fournis — jamais de
 * substitution silencieuse entre gradé/brut ou entre deux variantes/printings
 * différents. Sans indice de variante fourni, toutes les variantes du type
 * demandé (raw/graded) sont retournées, chacune correctement étiquetée.
 */
function buildCandidateVariants(card: JustTcgRawCard, hints: TcgCatalogHints): JustTcgRawVariant[] {
  const wantsGraded = Boolean(hints.gradingCompany || hints.grade || hints.kind === "graded_card");

  return card.variants.filter((variant) => {
    if (wantsGraded !== (variant.type === "graded")) return false;

    if (wantsGraded && hints.gradingCompany) {
      if (!variant.grading || normalizeForCompare(variant.grading.company) !== normalizeForCompare(hints.gradingCompany)) {
        return false;
      }
    }
    if (wantsGraded && hints.grade) {
      if (!variant.grading || variant.grading.canonical.toLowerCase() !== `${hints.gradingCompany ?? ""} ${hints.grade}`.trim().toLowerCase()) {
        // Comparaison tolérante : on accepte aussi une correspondance sur le grade numérique seul.
        const numericGrade = Number(hints.grade);
        if (!variant.grading || variant.grading.grade !== numericGrade) return false;
      }
    }

    const requestedVariant = hints.extra?.variant ?? hints.extra?.printing;
    if (requestedVariant && variant.printing) {
      if (normalizeForCompare(variant.printing) !== normalizeForCompare(requestedVariant)) return false;
    }

    return true;
  });
}

function buildObservation(
  card: JustTcgRawCard,
  variant: JustTcgRawVariant,
  market: JustTcgRawMarket,
  confidence: number,
  warnings: string[],
): NormalizedPriceObservation | null {
  // Jamais de valeur fabriquée : une absence réelle de donnée locale (`price: null`) ne produit aucune observation.
  if (market.price === null) return null;

  return {
    source: "justtcg",
    externalProductId: variant.id,
    game: card.game.name,
    name: card.name,
    setName: card.set.name ?? null,
    setId: card.set.id,
    number: card.number ?? null,
    variant: variant.printing ?? null,
    language: variant.language ?? null,
    condition: variant.condition ?? null,
    gradingCompany: variant.grading?.company ?? null,
    grade: variant.grading ? variant.grading.canonical : null,
    amountCents: centsFromDollars(market.price),
    currency: market.currency,
    priceType: "market_aggregate",
    updatedAt: market.updated_at ? new Date(market.updated_at * 1000).toISOString() : null,
    region: market.region,
    provenance: "justtcg-api-v2",
    confidence,
    warnings,
  };
}

/**
 * Carte brute + indices → observations de prix normalisées. Une observation
 * par (variante × marché) réellement retournée par l'API — jamais de
 * substitution entre variantes, jamais de mélange brut/gradé.
 */
export function normalizeJustTcgCard(card: JustTcgRawCard, hints: TcgCatalogHints): NormalizedPriceObservation[] {
  const candidates = buildCandidateVariants(card, hints);
  const observations: NormalizedPriceObservation[] = [];

  for (const variant of candidates) {
    const { confidence, matchedOn } = scoreMatch(card, variant, hints);
    const warnings = [NORTH_AMERICA_WARNING];
    if (confidence < 1 && matchedOn.filter((m) => !m.startsWith("condition:")).length <= 1) {
      warnings.push(AMBIGUOUS_MATCH_WARNING);
    }

    for (const market of variant.markets) {
      const observation = buildObservation(card, variant, market, confidence, warnings);
      if (observation) observations.push(observation);
    }
  }

  return observations;
}
