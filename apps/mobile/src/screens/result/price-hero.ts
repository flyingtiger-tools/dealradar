import type { ResultViewModel } from "./result-view-model";

export interface HeroPriceRange {
  low: number;
  high: number;
  currency: string;
}

/**
 * Dérive la fourchette de prix "hero" à afficher en tête de résultat (Phase
 * 11, LOT "visual product pass") — SEULE formule réelle, réutilisée par
 * `ResultScreen` (affichage) ET `format/share.ts` (texte partagé) : avant
 * ce lot, `ResultScreen.tsx` gardait une copie locale de cette règle avec
 * un commentaire promettant "jamais une seconde formule qui pourrait
 * diverger" — cette fonction tient enfin cette promesse en devenant le
 * seul point d'accès. Montant natif CHF si la source est déjà en CHF,
 * sinon le montant déjà converti si disponible, JAMAIS une moyenne ni un
 * mélange de devises non converties. `null` si aucun prix exploitable —
 * l'appelant doit alors afficher "Prix indisponible", jamais `0`/`NaN`/`—`.
 */
export function deriveHeroPriceRange(view: Pick<ResultViewModel, "prices">): HeroPriceRange | null {
  const amounts = view.prices
    .map((p) => p.convertedAmountCents ?? (p.currency === "CHF" ? p.amountCents : null))
    .filter((v): v is number => v !== null);
  if (amounts.length === 0) return null;
  return { low: Math.min(...amounts) / 100, high: Math.max(...amounts) / 100, currency: "CHF" };
}
