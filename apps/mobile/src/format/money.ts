/**
 * Formatage de prix centralisé (LOT "beta product readiness", Phase 26) —
 * jamais `${price} EUR` construit à la main dans un écran. Affichage
 * seulement, AUCUNE conversion FX ici (celle-ci vit déjà côté pipeline,
 * `orchestrate-pokemon-pipeline`/`persist-tcg-price-observation`, jamais
 * dupliquée côté mobile).
 */

const CURRENCY_LOCALE: Record<string, string> = {
  CHF: "fr-CH",
  EUR: "fr-FR",
  USD: "en-US",
  GBP: "en-GB",
};

/** Devise inconnue -> repli sur `fr-CH` (thème de l'app) plutôt qu'un crash `Intl.NumberFormat`. */
export function formatMoney(value: number, currency: string): string {
  const locale = CURRENCY_LOCALE[currency] ?? "fr-CH";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    // `currency` non reconnu par `Intl` (ex. code invalide transmis par erreur) — jamais un throw visible à l'utilisateur.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Fourchette basse/haute — mêmes règles que `formatMoney`, jamais deux devises différentes affichées côte à côte sans le dire. */
export function formatMoneyRange(low: number, high: number, currency: string): string {
  if (low === high) return formatMoney(low, currency);
  return `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`;
}
