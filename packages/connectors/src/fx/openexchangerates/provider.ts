import { ConnectorError } from "../../types";
import type { FxRate, FxRateProvider } from "../types";
import { createOpenExchangeRatesHttpClient, type OpenExchangeRatesClientOptions } from "./client";
import { openExchangeRatesResponseSchema } from "./raw-types";

const SOURCE = "openexchangerates";

/**
 * `FxRateProvider` Open Exchange Rates — palier Developer ou supérieur
 * requis pour changer `base` (voir audit LOT 6) ; DealRadar convertit
 * toujours depuis USD, déjà la base par défaut de tous les paliers, donc
 * aucune dépendance à cette restriction. Jamais de taux inventé : `null` si
 * la devise demandée n'apparaît pas dans la réponse.
 */
export function createOpenExchangeRatesProvider(config: OpenExchangeRatesClientOptions): FxRateProvider {
  const client = createOpenExchangeRatesHttpClient(config);

  async function getRate(baseCurrency: string, quoteCurrency: string, onDate?: string): Promise<FxRate | null> {
    const path = onDate ? `/historical/${onDate}.json` : "/latest.json";
    const raw = await client.get(path, { base: baseCurrency, symbols: quoteCurrency });

    const parsed = openExchangeRatesResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Open Exchange Rates invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    const rate = parsed.data.rates[quoteCurrency];
    if (rate === undefined) return null;

    const rateDate = onDate ?? new Date(parsed.data.timestamp * 1000).toISOString().slice(0, 10);

    return {
      baseCurrency: parsed.data.base,
      quoteCurrency,
      rate,
      rateDate,
      source: SOURCE,
      fetchedAt: new Date().toISOString(),
    };
  }

  return { source: SOURCE, getRate };
}
