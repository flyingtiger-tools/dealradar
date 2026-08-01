/**
 * Conversion de devises traçable (ADR 0012, LOT 6) — distinct des quatre
 * familles de connecteurs (Marketplace/Catalog/Pricing/AI) : un taux de
 * change n'est ni un catalogue, ni un prix marché, il sert uniquement à
 * traduire un montant déjà obtenu par ailleurs. Volontairement en dehors du
 * Connector Registry / Capability Engine (LOT 4) pour cette raison.
 */

/** Un taux figé à une date précise, jamais une valeur "courante" implicite. */
export interface FxRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  /** Date (ISO `YYYY-MM-DD`) à laquelle ce taux s'applique — jamais confondue avec `fetchedAt`. */
  rateDate: string;
  source: string;
  /** Quand DealRadar a effectivement récupéré ce taux — distinct de `rateDate`. */
  fetchedAt: string;
}

export interface FxRateProvider {
  readonly source: string;
  /** `onDate` (ISO `YYYY-MM-DD`) : taux historique. Omis : dernier taux disponible. `null` si la paire n'est pas fournie. */
  getRate(baseCurrency: string, quoteCurrency: string, onDate?: string): Promise<FxRate | null>;
}
