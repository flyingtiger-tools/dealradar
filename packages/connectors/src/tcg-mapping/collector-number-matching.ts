/**
 * Comparaison déterministe de numéros de collection entre fournisseurs —
 * démontré nécessaire par appel réel : JustTCG renvoie "058/102" (zéro de
 * tête + dénominateur "/total"), Pokémon TCG API et TCGdex renvoient "58"
 * pour la même carte réelle (LOT 7C).
 *
 * Retire uniquement ce qui est déterministe et sans ambiguïté :
 *   - le dénominateur "/total" (notation standard TCG "X/Y" — jamais un
 *     numéro de carte différent, toujours la taille du set) ;
 *   - les zéros de tête.
 * Jamais de troncature au-delà : un numéro alphanumérique (ex. "SWSH001",
 * "TG01") reste inchangé, aucun zéro de tête n'est retiré après une lettre.
 */
export function normalizeCollectorNumber(raw: string): string {
  const withoutTotal = raw.split("/")[0] ?? raw;
  return withoutTotal.replace(/^0+(?=\d)/, "").trim().toLowerCase();
}

export function collectorNumbersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeCollectorNumber(a) === normalizeCollectorNumber(b);
}
