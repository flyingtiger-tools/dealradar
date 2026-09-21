import type { EvidenceType } from "./evidence-types";
import type { EvidenceQualityTier } from "./evidence-tiers";

/**
 * Observation de marché canonique (LOT "Multi-Source Market Intelligence
 * Foundation") — forme normalisée UNIQUE que toute source (marketplace,
 * retail agrégateur, spécialiste) doit produire pour alimenter
 * l'agrégateur multi-source (`packages/ingestion/src/aggregate-market-
 * observations.ts`) et, plus tard, la persistance historique
 * (`market_observations`, `supabase/migrations/0018_...sql`).
 *
 * Distincte de `NormalizedListing`/`NormalizedComparable`
 * (`../types.ts`/`@dealradar/core`) : ce type est le contrat COMMUN entre
 * connecteurs hétérogènes (API officielle, agrégateur de scraping,
 * spécialiste), avant tout mapping vers le monde Intelligence Core — même
 * discipline de séparation déjà en vigueur entre connecteurs et core
 * (voir `packages/connectors/src/types.ts`, en-tête du fichier).
 *
 * Règle absolue, jamais transgressée : `soldAt` n'est JAMAIS déduit de la
 * disparition d'une annonce — une annonce qui disparaît devient "plus
 * observée", jamais "vendue", sauf si la source confirme explicitement une
 * vente (voir `evidenceType: "soldTransactions"` uniquement).
 */
export interface MarketObservation {
  /** Slug de source (ex. "ebay", "google_shopping_serpapi", "bricklink") — jamais un nom marketing, toujours l'identifiant technique du connecteur. */
  source: string;
  /** Identifiant de l'annonce/l'entrée CHEZ LA SOURCE — jamais généré côté DealRadar. */
  sourceItemId: string;
  /** `null` si la source ne fournit pas de lien direct (ex. certains agrégateurs retail) — jamais une URL reconstruite/devinée. */
  sourceUrl: string | null;
  /** Horodatage réel de la collecte (jamais `Date.now()` implicite ailleurs — toujours explicite ici). */
  observedAt: string;

  /** Clé produit canonique DealRadar si déjà résolue (ex. via un Catalog Connector) — `null` si l'observation n'est pas encore rattachée à une identité précise. */
  productKey: string | null;
  /** Requête réellement envoyée à la source — traçabilité, jamais reconstruite après coup. */
  query: string;

  title: string;
  brand: string | null;
  model: string | null;
  variant: string | null;
  /** Identifiants structurels connus (MPN/EAN/UPC/etc.) — bag ouvert, jamais un champ inventé si la source ne les fournit pas. */
  identifiers: Record<string, string>;

  /** État déclaré par la source, dans SON propre vocabulaire brut — jamais reformulé ici (voir `ItemConditionRaw` pour la normalisation DealRadar, faite par l'appelant). */
  condition: string | null;
  /** Complétude déclarée (ex. "complete_in_box", "loose", "cib") si la source la fournit — `null` sinon, jamais devinée. */
  completeness: string | null;

  priceAmountCents: number;
  currency: string;
  shippingCostCents: number | null;
  /** `priceAmountCents + shippingCostCents` UNIQUEMENT si les deux sont connus dans la MÊME devise — `null` sinon, jamais un total partiel présenté comme complet. */
  totalPriceCents: number | null;

  /** Pays/marché de la source (ex. "CH", "US") — jamais assimilé à la devise (une source US peut coter en CHF). */
  country: string | null;
  marketplace: string;

  evidenceType: EvidenceType;
  /** Palier réel de cette observation précise — surcharge possible du défaut `EvidenceType` -> palier (`defaultTierForEvidenceType`) si la source a une connaissance plus fine (ex. un `historicalPrices` calculé sur un très grand échantillon peut rester B, mais un connecteur pourrait un jour justifier un déclassement pour une source peu fiable). */
  evidenceTier: EvidenceQualityTier;
  /**
   * Horodatage de vente RÉELLEMENT CONFIRMÉ par la source — `null` dans
   * TOUS les autres cas, y compris quand une annonce active a disparu.
   * Ne JAMAIS déduire une vente d'une disparition d'annonce (règle
   * absolue du lot).
   */
  soldAt: string | null;

  /** 0–1, calculé honnêtement à partir des indices qui ont réellement matché la requête — jamais une estimation devinée. */
  matchScore: number;

  /** Référence vers le payload brut minimisé (jamais l'objet complet en clair ici) — voir `redact.ts` pour le patron déjà en place côté eBay. */
  rawMetadataRef: unknown;

  /** `observedAt` reformulé en âge relatif au moment de l'ingestion — calculé par l'agrégateur, jamais par le connecteur lui-même (qui ne connaît pas "maintenant" au moment de la persistance). */
  freshnessHours?: number;

  /** Version du format d'ingestion — incrémentée à chaque changement de forme de ce type, pour permettre une migration progressive des observations déjà persistées. */
  ingestionVersion: number;
}

/** Incrémentée à chaque changement de la forme de `MarketObservation` — entre dans `market_observations.ingestion_version`. */
export const MARKET_OBSERVATION_INGESTION_VERSION = 1;

/**
 * Clé de déduplication stable — même observation vue deux fois (ex. deux
 * requêtes de repli qui se chevauchent) ne doit jamais compter deux fois.
 * Volontairement PAS basée sur le prix (un prix qui change EST une
 * nouvelle observation utile à l'historique, jamais un doublon à fusionner).
 */
export function marketObservationDedupeKey(observation: Pick<MarketObservation, "source" | "sourceItemId" | "observedAt">): string {
  return `${observation.source}:${observation.sourceItemId}:${observation.observedAt}`;
}
