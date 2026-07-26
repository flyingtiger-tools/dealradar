/** Formatage monétaire cohérent dans toute l'application. */
export function formatPrice(cents: number, currency = "CHF", locale = "fr-CH"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Formatage de date cohérent dans toute l'application. */
export function formatDate(value: string | null, locale = "fr-CH"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value));
}
