import type { FxRate, FxRateProvider } from "./types";

/**
 * Inverse un taux (base/quote échangés, `rate' = 1/rate`) — jamais une
 * seconde source de vérité : mêmes `rateDate`/`source`/`fetchedAt` que le
 * taux d'origine, seule l'orientation change. Utile quand un fournisseur
 * ne renvoie qu'une direction d'une paire (ex. CHF->USD connu mais pas
 * USD->CHF demandé) — `resolveFxRates` l'utilise en repli, jamais en
 * premier choix (voir son en-tête).
 */
export function invertFxRate(rate: FxRate): FxRate {
  return {
    baseCurrency: rate.quoteCurrency,
    quoteCurrency: rate.baseCurrency,
    rate: 1 / rate.rate,
    rateDate: rate.rateDate,
    source: rate.source,
    fetchedAt: rate.fetchedAt,
  };
}

/**
 * Résout un taux `sourceCurrency` -> `targetCurrency` : direct d'abord,
 * puis la direction inverse (`targetCurrency` -> `sourceCurrency`) si le
 * fournisseur ne la connaît que dans l'autre sens — jamais une
 * triangulation via une devise pivot (non nécessaire : Frankfurter et
 * OpenExchangeRates, les deux fournisseurs réels de ce paquet, acceptent
 * une paire base/quote arbitraire directement). `null` si aucune des deux
 * directions n'est disponible — jamais un taux deviné.
 */
export async function resolveOneFxRate(
  provider: FxRateProvider,
  sourceCurrency: string,
  targetCurrency: string,
  onDate?: string,
): Promise<FxRate | null> {
  if (sourceCurrency === targetCurrency) return null; // rien à résoudre — l'appelant ne devrait jamais demander cette paire (voir `resolveFxRates`).

  const direct = await provider.getRate(sourceCurrency, targetCurrency, onDate);
  if (direct) return direct;

  const inverse = await provider.getRate(targetCurrency, sourceCurrency, onDate);
  return inverse ? invertFxRate(inverse) : null;
}

/**
 * Résout un taux pour CHAQUE devise de `sourceCurrencies` vers
 * `targetCurrency` (LOT "Source Wave 3", section 1) — point d'entrée
 * utilisé par `orchestrateMarketIntelligence` (`@dealradar/ingestion`)
 * pour convertir automatiquement des observations en devise étrangère.
 * Une devise pour laquelle AUCUN taux (direct ou inverse) n'est trouvé est
 * simplement absente du résultat — jamais une exception, jamais un taux
 * deviné ; l'appelant (`mapMarketObservationsToFusionObservations`)
 * écarte déjà proprement toute observation sans taux disponible.
 */
export async function resolveFxRates(
  provider: FxRateProvider,
  targetCurrency: string,
  sourceCurrencies: readonly string[],
  onDate?: string,
): Promise<Record<string, FxRate>> {
  const distinctCurrencies = [...new Set(sourceCurrencies)].filter((c) => c !== targetCurrency);

  const results = await Promise.all(
    distinctCurrencies.map(async (currency) => ({ currency, rate: await resolveOneFxRate(provider, currency, targetCurrency, onDate) })),
  );

  const rates: Record<string, FxRate> = {};
  for (const { currency, rate } of results) {
    if (rate) rates[currency] = rate;
  }
  return rates;
}
