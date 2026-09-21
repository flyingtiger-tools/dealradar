import type { MarketObservation } from "./market-observation";
import { isStrongerTier } from "./evidence-tiers";

/**
 * Dédoublonnage par ORIGINE CANONIQUE (LOT "Source Wave 3", section 7) —
 * distinct de `marketObservationDedupeKey` (`market-observation.ts`, clé
 * source+item+horodatage, ne peut jamais rapprocher deux CONNECTEURS
 * différents). Ce module traite le cas où DEUX agrégateurs larges
 * différents (ex. SerpApi et DataForSEO, tous deux Google Shopping) ou un
 * agrégateur et le marchand original restituent la MÊME offre réelle sous
 * deux `source` distincts — sans ce passage, elle compterait deux fois
 * dans le volume de preuve alors qu'il s'agit d'un seul signal.
 *
 * Volontairement CONSERVATEUR — ne fusionne QUE quand TOUS ces critères
 * sont réunis :
 * - un identifiant STRUCTUREL fiable (UPC/EAN/GTIN/MPN) est présent et
 *   identique des deux côtés (jamais un rapprochement par simple titre —
 *   texte libre trop ambigu pour distinguer size/storage/variant, exactement
 *   le risque de "faux rapprochement" que ce lot demande d'éviter) ;
 * - le `marketplace` (marchand réel, voir `MarketObservation.marketplace`)
 *   est identique des deux côtés — un même identifiant vendu par deux
 *   marchands différents reste deux observations distinctes ;
 * - la devise est identique (jamais une comparaison de prix inter-devises) ;
 * - la condition, quand connue des DEUX côtés, est identique (jamais
 *   neuf/occasion fusionnés, même règle que `isCompatibleWithTarget`,
 *   `@dealradar/core`) ;
 * - le prix est quasi identique (tolérance 2 % — deux annonces du même
 *   marchand pour le même article ne devraient jamais différer plus que
 *   des arrondis/variations de change mineures).
 */

const IDENTIFIER_PRIORITY = ["upc", "ean", "gtin", "mpn"] as const;
const PRICE_TOLERANCE_RATIO = 0.02;

function identifierKeyFor(observation: MarketObservation): string | null {
  for (const key of IDENTIFIER_PRIORITY) {
    const value = observation.identifiers[key];
    if (value) return `${key}:${value}`;
  }
  return null;
}

function pricesNearIdentical(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff / Math.max(a, b, 1) <= PRICE_TOLERANCE_RATIO;
}

function isSameCanonicalOrigin(a: MarketObservation, b: MarketObservation): boolean {
  const identifierKeyA = identifierKeyFor(a);
  const identifierKeyB = identifierKeyFor(b);
  if (!identifierKeyA || identifierKeyA !== identifierKeyB) return false;
  if (a.marketplace !== b.marketplace) return false;
  if (a.currency !== b.currency) return false;
  if (a.condition && b.condition && a.condition !== b.condition) return false;
  return pricesNearIdentical(a.priceAmountCents, b.priceAmountCents);
}

export interface CanonicalOriginDedupeResult {
  observations: MarketObservation[];
  /** Nombre d'observations FUSIONNÉES dans une autre (jamais silencieux — utile pour les diagnostics de provenance). */
  mergedCount: number;
}

/**
 * Repère les observations qui partagent la même origine canonique (voir
 * l'en-tête) et n'en garde qu'UNE par groupe — celle du palier de preuve
 * le PLUS FORT (à égalité, garde celle déjà rencontrée en premier, jamais
 * un choix arbitraire qui varierait d'un appel à l'autre). Une observation
 * sans identifiant structurel fiable n'est JAMAIS candidate à la fusion —
 * elle est toujours conservée telle quelle.
 */
export function dedupeByCanonicalOrigin(observations: readonly MarketObservation[]): CanonicalOriginDedupeResult {
  const kept: MarketObservation[] = [];
  let mergedCount = 0;

  for (const observation of observations) {
    const identifierKey = identifierKeyFor(observation);
    if (!identifierKey) {
      kept.push(observation);
      continue;
    }

    const duplicateIndex = kept.findIndex((existing) => isSameCanonicalOrigin(existing, observation));
    if (duplicateIndex === -1) {
      kept.push(observation);
      continue;
    }

    mergedCount += 1;
    const existing = kept[duplicateIndex]!;
    if (isStrongerTier(observation.evidenceTier, existing.evidenceTier)) {
      kept[duplicateIndex] = observation;
    }
  }

  return { observations: kept, mergedCount };
}
