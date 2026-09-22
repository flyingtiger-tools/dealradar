import type { CatalogItem, CatalogMatch } from "../../types";
import type { SparqlResults } from "./raw-types";

/**
 * `wdt:P3962` = "Global Trade Item Number" (GTIN-8/12/13/14) — SEULE
 * propriété d'identifiant exact utilisée ce lot (LOT "Free/Open Sources +
 * Real Readiness + Live Smoke Tests", section 5) : confirmée par appel
 * réel (`00640520098905` -> Q29972750, "Apple iPhone 7 128GB Jet Black").
 * Aucune propriété de référence fabricant/modèle (MPN) suffisamment fiable
 * n'a pu être confirmée par appel réel ce lot — délibérément PAS
 * implémentée plutôt que devinée (règle absolue : "exact/unambiguous
 * identifiers only").
 */
export function buildExactGtinQuery(gtin: string): string {
  // `gtin` n'est JAMAIS interpolé sans échappement — un GTIN attendu est
  // strictement numérique (8-14 chiffres), mais on échappe quand même les
  // guillemets/antislash par prudence plutôt que de supposer l'entrée
  // toujours propre (même discipline que le reste du projet : jamais une
  // confiance aveugle en une validation amont).
  const escaped = gtin.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `SELECT ?item ?itemLabel ?manufacturerLabel WHERE { ?item wdt:P3962 "${escaped}" . OPTIONAL { ?item wdt:P176 ?manufacturer . } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
}

function entityIdFromUri(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? uri;
}

/**
 * Résultats SPARQL bruts → `CatalogItem[]` — un item par entité DISTINCTE
 * (déduplique les lignes qu'une jointure `OPTIONAL` peut multiplier).
 * ENRICHISSEMENT D'IDENTITÉ UNIQUEMENT — jamais un prix (Wikidata n'en
 * fournit aucun d'exploitable pour ce cas d'usage).
 */
export function normalizeSparqlGtinResults(results: SparqlResults, gtin: string, categorySlug: string): CatalogItem[] {
  const byEntity = new Map<string, { uri: string; label: string | null; manufacturer: string | null }>();

  for (const binding of results.results.bindings) {
    const itemUri = binding.item?.value;
    if (!itemUri) continue;
    const entityId = entityIdFromUri(itemUri);
    const existing = byEntity.get(entityId) ?? { uri: itemUri, label: null, manufacturer: null };
    if (binding.itemLabel?.value) existing.label = binding.itemLabel.value;
    if (binding.manufacturerLabel?.value) existing.manufacturer = binding.manufacturerLabel.value;
    byEntity.set(entityId, existing);
  }

  return [...byEntity.entries()].map(([entityId, entry]) => ({
    source: "wikidata",
    externalId: entityId,
    kind: "wikidata_entity",
    categorySlug,
    // `itemLabel` absent uniquement si l'entité n'a pas d'étiquette EN —
    // repli sur l'ID Wikidata brut (`Q...`), jamais un nom inventé (même
    // discipline que `matchTcgdexCard`/`normalizeOpenFactsProduct`).
    name: entry.label ?? entityId,
    canonicalAttributes: {
      gtin,
      manufacturer: entry.manufacturer,
      wikidataId: entityId,
    },
    images: [],
    externalUrl: entry.uri,
    raw: entry,
  }));
}

export function matchSparqlGtinResults(results: SparqlResults, gtin: string, categorySlug: string): CatalogMatch[] {
  // Correspondance EXACTE de GTIN uniquement — confiance maximale pour
  // CHAQUE entité retournée (Wikidata a déjà fait la correspondance
  // exacte côté serveur, jamais une similarité floue ici) ; plusieurs
  // entités pour un même GTIN (rare mais possible, doublon de données
  // communautaires) restent TOUTES retournées, jamais une seule choisie
  // arbitrairement — c'est à l'appelant de trancher.
  return normalizeSparqlGtinResults(results, gtin, categorySlug).map((item) => ({ item, confidence: 1, matchedOn: ["gtin"] }));
}
