import { ConnectorError } from "../../types";
import type { FxRate, FxRateProvider } from "../types";
import { createFrankfurterHttpClient, type FrankfurterClientOptions } from "./client";
import { frankfurterRatesResponseSchema } from "./raw-types";

const SOURCE = "frankfurter";

/**
 * `FxRateProvider` Frankfurter — fournisseur MVP par défaut : gratuit,
 * aucune clé API, aucun compte à créer. Voir `docs/fx-provider-swap.md`
 * pour les conditions exactes de bascule vers un fournisseur au statut
 * commercial explicite (ex. `../openexchangerates`, déjà construit) une
 * fois DealRadar en production commerciale.
 */
export function createFrankfurterProvider(config: FrankfurterClientOptions = {}): FxRateProvider {
  const client = createFrankfurterHttpClient(config);

  async function getRate(baseCurrency: string, quoteCurrency: string, onDate?: string): Promise<FxRate | null> {
    const raw = await client.get("/rates", { base: baseCurrency, quotes: quoteCurrency, date: onDate });

    const parsed = frankfurterRatesResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Frankfurter invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    const entry = parsed.data.find((e) => e.quote === quoteCurrency);
    if (!entry) return null;

    return {
      baseCurrency: entry.base,
      quoteCurrency: entry.quote,
      rate: entry.rate,
      rateDate: entry.date,
      source: SOURCE,
      fetchedAt: new Date().toISOString(),
    };
  }

  return { source: SOURCE, getRate };
}
