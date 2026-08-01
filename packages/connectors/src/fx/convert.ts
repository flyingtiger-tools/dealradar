import type { CrossMarketConversion, NormalizedPriceObservation } from "../types";
import type { FxRate } from "./types";

export type FxConversionOutcome =
  | { status: "converted"; conversion: CrossMarketConversion }
  | { status: "refused"; reason: string };

export interface ConvertOptions {
  /** Au-delà de cet âge, un taux est refusé plutôt qu'utilisé silencieusement. */
  maxRateAgeHours: number;
  /** Horloge injectable pour les tests — `Date.now` par défaut. */
  now?: () => Date;
}

function hoursSince(rateDate: string, now: Date): number {
  const rateMs = new Date(`${rateDate}T00:00:00.000Z`).getTime();
  return (now.getTime() - rateMs) / (1000 * 60 * 60);
}

/**
 * Convertit une observation de prix — jamais en place : produit un
 * `CrossMarketConversion` séparé, `observation.amountCents`/`currency`
 * restent inchangés (voir `NormalizedPriceObservation.conversion`, préparé
 * au LOT 2, jamais branché avant ce lot). Refuse plutôt que d'inventer :
 * taux absent, taux pour la mauvaise devise, taux trop ancien, taux non
 * positif, ou observation déjà convertie (jamais une double conversion).
 */
export function convertPriceObservation(
  observation: NormalizedPriceObservation,
  rate: FxRate | null,
  options: ConvertOptions,
): FxConversionOutcome {
  if (observation.conversion) {
    return { status: "refused", reason: "Observation déjà convertie — une conversion existante n'est jamais remplacée." };
  }

  if (!rate) {
    return { status: "refused", reason: `Aucun taux de change disponible pour ${observation.currency}.` };
  }

  if (rate.baseCurrency !== observation.currency) {
    return {
      status: "refused",
      reason: `Taux fourni pour ${rate.baseCurrency}, observation en ${observation.currency} — paire incompatible, refusé plutôt que mal appliqué.`,
    };
  }

  if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
    return { status: "refused", reason: "Taux invalide (non positif) — refusé plutôt qu'utilisé." };
  }

  const now = (options.now ?? (() => new Date()))();
  const ageHours = hoursSince(rate.rateDate, now);
  if (ageHours > options.maxRateAgeHours) {
    return {
      status: "refused",
      reason: `Taux du ${rate.rateDate} trop ancien (${ageHours.toFixed(1)}h > ${options.maxRateAgeHours}h autorisées) — refusé plutôt qu'utilisé silencieusement.`,
    };
  }

  const convertedAmountCents = Math.round(observation.amountCents * rate.rate);

  return {
    status: "converted",
    conversion: {
      originalAmountCents: observation.amountCents,
      originalCurrency: observation.currency,
      rate: rate.rate,
      rateDate: rate.rateDate,
      convertedAmountCents,
      convertedCurrency: rate.quoteCurrency,
      warning: `Converti ${rate.baseCurrency}→${rate.quoteCurrency} au taux du ${rate.rateDate} (source : ${rate.source}) — ne représente jamais une vente confirmée en ${rate.quoteCurrency}.`,
    },
  };
}
