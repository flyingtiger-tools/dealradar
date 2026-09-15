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
