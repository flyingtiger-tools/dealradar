/**
 * Dérive le `collectorNumber` utilisé UNIQUEMENT pour interroger les
 * connecteurs de catalogue (jamais pour l'affichage/la persistance — le
 * numéro imprimé original, `cardNumber`, reste toujours inchangé ailleurs
 * dans le pipeline).
 *
 * Ne retire QUE la partie "/total" quand le format est strictement
 * "chiffres/chiffres" (notation standard imprimée sur la carte, ex.
 * "096/094") — prouvé nécessaire par appel réel à la Pokémon TCG API le
 * 2026-08-03 : `number:58/102` (slash brut) → 400 Bad Request,
 * `number:58` → 200. Le numérateur est conservé TEL QUEL, zéros de tête
 * compris (ex. "096/094" → "096") : rien ne prouve encore que ces zéros
 * sont toujours superflus pour l'index de l'API — voir
 * `catalogs/pokemon-tcg/connector.ts` pour la stratégie de second essai
 * (sans zéro de tête) propre à ce seul connecteur.
 *
 * Tout format non reconnu (alphanumérique type "SWSH001"/"SVP001", motif
 * inattendu, vide) passe inchangé — jamais un split deviné.
 */
const PRINTED_NUMBER_OVER_TOTAL = /^([0-9]+)\/([0-9]+)$/;

export function deriveCollectorNumberForCatalogQuery(printed: string | null | undefined): string | undefined {
  if (!printed) return undefined;
  const match = PRINTED_NUMBER_OVER_TOTAL.exec(printed);
  return match ? match[1]! : printed;
}
