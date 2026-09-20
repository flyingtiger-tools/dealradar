/**
 * Nom de source lisible (LOT "beta product readiness", Phase 28) — jamais
 * un identifiant technique interne brut affiché sans traduction quand une
 * traduction connue existe. Une source inconnue n'est jamais masquée
 * (jamais un "Source inconnue" qui cacherait une vraie donnée) : elle est
 * juste mise en forme (première lettre capitalisée) plutôt qu'affichée en
 * minuscules brutes.
 */
const KNOWN_SOURCE_LABELS: Record<string, string> = {
  tcgdex: "TCGdex",
  cardmarket: "Cardmarket",
  justtcg: "JustTCG",
  ebay: "eBay",
};

export function formatSourceLabel(source: string | null): string | null {
  if (!source || source.trim() === "") return null;
  const key = source.trim().toLowerCase();
  if (KNOWN_SOURCE_LABELS[key]) return KNOWN_SOURCE_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Libellé de PROVENANCE (`marketDataProvenanceSchema`, `@dealradar/contracts`)
 * — distinct d'un nom de source marketplace (`formatSourceLabel`). LOT
 * "Données marché réelles + préparation E2E" : corrige un bogue réel où
 * `ResultScreen` affichait la provenance brute (ex. `"active_listing"`) en
 * la faisant passer par `formatSourceLabel`, produisant un libellé
 * technique confus ("Active_listing") plutôt qu'une phrase honnête sur la
 * nature du prix. Ne masque JAMAIS qu'un prix n'est pas une vente confirmée
 * (règle produit absolue, section 6 du brief) — c'est précisément le rôle
 * de ce libellé pour `"active_listing"`.
 */
const PROVENANCE_LABELS: Record<string, string> = {
  sold_transaction: "Vente confirmée",
  market_guide: "Guide de prix",
  active_listing: "Annonce active — pas une vente confirmée",
  retail_price: "Prix neuf",
  estimated_value: "Estimation",
};

/** `null` pour `"unknown"`/une valeur non reconnue — jamais un libellé de provenance inventé (voir `formatSourceLabel` pour le repli source générique dans ce cas). */
export function formatProvenanceLabel(provenance: string | null): string | null {
  if (!provenance || provenance.trim() === "") return null;
  return PROVENANCE_LABELS[provenance.trim().toLowerCase()] ?? null;
}
