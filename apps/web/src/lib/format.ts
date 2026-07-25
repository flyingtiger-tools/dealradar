/** Formatage monétaire cohérent dans toute l'application. */
export function formatPrice(cents: number, currency = "CHF", locale = "fr-CH"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
