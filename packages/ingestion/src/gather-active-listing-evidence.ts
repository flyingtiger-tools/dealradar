import type { MarketplaceConnector, NormalizedListing as ConnectorListing } from "@dealradar/connectors";
import { hasCapability } from "@dealradar/connectors";
import type { NormalizedComparable, SearchQueries } from "@dealradar/core";

/**
 * Rassemble des annonces ACTIVES (prix demandé, jamais confirmé) via
 * `MarketplaceConnector.search()` — LOT "Universal Object Valuation
 * Foundation". Alimente le repli `activeComparables` d'Intelligence Core
 * (`packages/core/src/intelligence/pipeline.ts`) quand aucune vente
 * confirmée n'est disponible. N'écrit jamais en base (contrairement à
 * `runIngestion()`/`persistListing()`, réservés à l'ingestion de masse
 * planifiée) — cette fonction sert un chemin synchrone, à la demande, pour
 * une seule analyse mobile/web.
 *
 * **Limite honnête et documentée** : eBay (seul `MarketplaceConnector`
 * réel du repo aujourd'hui) restitue ses `attributes` sous les noms bruts
 * de ses "item specifics" (`localizedAspects`, voir
 * `packages/connectors/src/ebay/normalize.ts`), JAMAIS mappés vers les
 * clés de profil DealRadar (`brand`, `model`, etc. — limite déjà
 * documentée là-bas, ADR 0008, jamais résolue faute de vérification avec
 * des identifiants réels). Cette fonction ne tente donc AUCUN mapping
 * heuristique risqué : les comparables produits ici ne passeront le
 * filtre de similarité d'un profil de catégorie exigeant
 * (`similarityAttributeKeys` non vide) que si l'appelant a lui-même déjà
 * réconcilié ces attributs — en pratique, utile dès aujourd'hui surtout
 * pour la catégorie `general` (similarité purement structurelle). Pas une
 * fausse promesse de couverture totale.
 */

export interface GatherActiveListingEvidenceInput {
  connector: MarketplaceConnector;
  categorySlug: string;
  queries: SearchQueries;
  /** Résultats par requête — garde-fou, jamais illimité. */
  limitPerQuery?: number;
  /** Nombre de requêtes tentées au maximum (exacte + replis) — garde-fou contre un repli en cascade coûteux. */
  maxQueriesAttempted?: number;
  /** Arrête d'essayer d'autres replis une fois ce volume de comparables dédupliqués atteint. */
  stopAfterCount?: number;
}

const DEFAULT_LIMIT_PER_QUERY = 25;
const DEFAULT_MAX_QUERIES_ATTEMPTED = 3;
const DEFAULT_STOP_AFTER_COUNT = 10;

/** `NormalizedListing` (connecteur) → `NormalizedComparable` (Intelligence Core) — toujours `soldAt: null` (annonce active, jamais une vente). Rejette un item sans état exploitable (jamais deviné, même règle que `mapSoldRowToComparable`). */
function toComparable(listing: ConnectorListing): NormalizedComparable | null {
  if (!listing.condition) return null;
  return {
    id: `${listing.meta.source}:${listing.meta.externalId}`,
    sourceSlug: listing.meta.source,
    title: listing.title,
    priceCents: listing.price.amountCents,
    currency: listing.price.currency,
    condition: listing.condition,
    categorySlug: listing.categorySlug,
    attributes: listing.attributes,
    soldAt: null,
  };
}

/**
 * Essaie `queries.exact` puis, si besoin, `queries.fallbacks` dans l'ordre,
 * s'arrête dès que `stopAfterCount` comparables uniques sont rassemblés ou
 * que `maxQueriesAttempted` requêtes ont été tentées. Déduplique par
 * `sourceSlug:id` à travers toutes les requêtes (une même annonce peut
 * ressortir de plusieurs requêtes de repli qui se chevauchent). Ne lève
 * jamais si le connecteur ne déclare pas la capacité `search` — retourne
 * simplement un pool vide (dégradation gracieuse, même discipline que le
 * reste du pipeline).
 */
export async function gatherActiveListingEvidence(
  input: GatherActiveListingEvidenceInput,
): Promise<NormalizedComparable[]> {
  const { connector, categorySlug, queries } = input;
  const limit = input.limitPerQuery ?? DEFAULT_LIMIT_PER_QUERY;
  const maxQueriesAttempted = input.maxQueriesAttempted ?? DEFAULT_MAX_QUERIES_ATTEMPTED;
  const stopAfterCount = input.stopAfterCount ?? DEFAULT_STOP_AFTER_COUNT;

  if (!hasCapability(connector, "search") || queries.exact.length === 0) return [];

  const candidateQueries = [queries.exact, ...queries.fallbacks].slice(0, maxQueriesAttempted);

  const seen = new Set<string>();
  const collected: NormalizedComparable[] = [];

  for (const q of candidateQueries) {
    if (collected.length >= stopAfterCount) break;

    const result = await connector.search({ q, categorySlug, limit });
    for (const rawListing of result.listings) {
      const comparable = toComparable(rawListing);
      if (!comparable || seen.has(comparable.id)) continue;
      seen.add(comparable.id);
      collected.push(comparable);
      if (collected.length >= stopAfterCount) break;
    }
  }

  return collected;
}
