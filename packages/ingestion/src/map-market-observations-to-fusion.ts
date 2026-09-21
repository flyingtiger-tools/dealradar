import type { MarketObservation } from "@dealradar/connectors";
import type { FxRate } from "@dealradar/connectors";
import type { FusionObservation } from "@dealradar/core";

/**
 * `MarketObservation[]` (`@dealradar/connectors`) -> `FusionObservation[]`
 * (`@dealradar/core`) — SEUL point du repo qui fait ce pont (LOT "Source
 * Wave 2", section 6/9), exactement comme prévu au lot précédent : `core`
 * garde son architecture "zéro dépendance à `connectors`", donc cette
 * conversion vit ici, dans `packages/ingestion`, qui dépend légitimement
 * des deux.
 *
 * Devise (section 9, focalisation Suisse) : une observation déjà dans la
 * devise cible passe telle quelle, jamais de conversion CHF->CHF inutile.
 * Une observation dans une AUTRE devise n'est convertie QUE si un taux
 * fiable, non expiré, pour LA BONNE PAIRE est fourni par l'appelant —
 * sinon elle est écartée (jamais silencieusement, voir `MapToFusionResult.
 * skipped`), jamais une conversion approximative.
 *
 * Prix utilisé pour la fusion : TOUJOURS `priceAmountCents` (prix article
 * seul), JAMAIS `totalPriceCents` — mélanger des observations où le port
 * est connu (donc inclus dans un total) avec d'autres où il ne l'est pas
 * biaiserait silencieusement la comparaison entre sources. Le port reste
 * visible sur `MarketObservation.shippingCostCents` pour un usage
 * d'affichage/diagnostic séparé, jamais fondu dans le prix comparé ici.
 */

export interface CurrencyConversionOptions {
  targetCurrency: string;
  /** Taux disponibles, indexés par devise SOURCE (ex. `{ USD: {...} }` pour convertir de l'USD vers `targetCurrency`) — la paire `baseCurrency`/`quoteCurrency` du taux doit correspondre exactement, jamais une conversion inverse implicite. */
  rates: Record<string, FxRate>;
  /** Au-delà de cet âge, un taux est refusé plutôt qu'utilisé silencieusement (même règle que `convertPriceObservation`, `@dealradar/connectors`). */
  maxRateAgeHours: number;
  now?: () => Date;
}

/**
 * Classe de raison STRUCTURÉE (LOT "Real DB Integration + Exact Budget
 * Enforcement + Runtime Observability", section 5) — permet à l'appelant
 * (le runner de rafraîchissement) de distinguer "aucun taux disponible"
 * ("missing_rate") de "taux périmé" ("stale_rate") sans analyser un texte
 * libre. `pair_mismatch`/`invalid_rate` restent des cas FX distincts eux
 * aussi, jamais confondus avec une panne de persistance.
 */
export type FxSkipReasonClass = "missing_rate" | "pair_mismatch" | "invalid_rate" | "stale_rate";

export interface SkippedObservation {
  observation: MarketObservation;
  reason: string;
  reasonClass: FxSkipReasonClass;
}

export interface MapToFusionResult {
  fusionObservations: FusionObservation[];
  /** Jamais silencieusement perdues — chaque observation écartée porte une raison explicite ET une classe structurée. */
  skipped: SkippedObservation[];
}

function convertedPriceCents(observation: MarketObservation, options: CurrencyConversionOptions, now: Date): { cents: number } | { reason: string; reasonClass: FxSkipReasonClass } {
  if (observation.currency === options.targetCurrency) return { cents: observation.priceAmountCents };

  const rate = options.rates[observation.currency];
  if (!rate) return { reason: `Aucun taux de change disponible pour ${observation.currency}->${options.targetCurrency}.`, reasonClass: "missing_rate" };
  if (rate.baseCurrency !== observation.currency || rate.quoteCurrency !== options.targetCurrency) {
    return { reason: `Taux fourni pour ${rate.baseCurrency}->${rate.quoteCurrency}, attendu ${observation.currency}->${options.targetCurrency} — paire incompatible, refusé plutôt que mal appliqué.`, reasonClass: "pair_mismatch" };
  }
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) return { reason: "Taux de change invalide (non positif) — refusé plutôt qu'utilisé.", reasonClass: "invalid_rate" };

  const rateAgeMs = now.getTime() - new Date(`${rate.rateDate}T00:00:00.000Z`).getTime();
  const rateAgeHours = rateAgeMs / (1000 * 60 * 60);
  if (rateAgeHours > options.maxRateAgeHours) {
    return { reason: `Taux du ${rate.rateDate} trop ancien (${rateAgeHours.toFixed(1)}h > ${options.maxRateAgeHours}h autorisées) — refusé plutôt qu'utilisé silencieusement.`, reasonClass: "stale_rate" };
  }

  return { cents: Math.round(observation.priceAmountCents * rate.rate) };
}

export function mapMarketObservationsToFusionObservations(
  observations: readonly MarketObservation[],
  options: CurrencyConversionOptions,
): MapToFusionResult {
  const now = (options.now ?? (() => new Date()))();
  const fusionObservations: FusionObservation[] = [];
  const skipped: SkippedObservation[] = [];

  for (const observation of observations) {
    const priceResult = convertedPriceCents(observation, options, now);
    if ("reason" in priceResult) {
      skipped.push({ observation, reason: priceResult.reason, reasonClass: priceResult.reasonClass });
      continue;
    }

    const attributes: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(observation.identifiers)) {
      attributes[key] = value;
    }

    fusionObservations.push({
      source: observation.source,
      // Origine réelle si distincte du connecteur (ex. Google Shopping qui restitue un `marketplace` marchand précis) — voir `fuse-market-observations.ts`, section 8. Égal au connecteur lui-même par défaut (`marketplace` vaut déjà souvent le même nom que `source` pour les connecteurs directs).
      merchant: observation.marketplace,
      sourceItemId: observation.sourceItemId,
      title: observation.title,
      priceCents: priceResult.cents,
      currency: options.targetCurrency,
      evidenceTier: observation.evidenceTier,
      observedAt: observation.observedAt,
      matchScore: observation.matchScore,
      condition: observation.condition,
      completeness: observation.completeness,
      attributes,
    });
  }

  return { fusionObservations, skipped };
}
