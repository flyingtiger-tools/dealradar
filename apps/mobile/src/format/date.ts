/**
 * Formatage de date centralisé (LOT "beta product readiness", Phase 27) —
 * jamais un timestamp ISO brut affiché dans l'historique. `date` accepte
 * une chaîne ISO ou un `Date` — jamais un throw sur une entrée invalide
 * (repli sur la chaîne brute, toujours mieux qu'un écran cassé).
 */
export function formatAnalysisDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return typeof date === "string" ? date : "";
  try {
    return new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    return d.toISOString();
  }
}
