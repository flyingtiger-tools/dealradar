import type { CatalogConnector, CatalogItem, CatalogMatch, CatalogQuery, ConnectorDescriptor, HealthCheckResult } from "../../types";
import { ConnectorError } from "../../types";
import { createWikidataClient, type WikidataClientOptions } from "./client";
import { buildExactGtinQuery, matchSparqlGtinResults } from "./normalize";
import { sparqlResultsSchema } from "./raw-types";

export interface WikidataCatalogHints {
  gtin?: string;
}

function isHints(value: unknown): value is WikidataCatalogHints {
  return typeof value === "object" && value !== null;
}

export interface WikidataCatalogConfig extends WikidataClientOptions {
  categorySlug?: string;
}

/**
 * Catalog Connector Wikidata (LOT "Free/Open Sources + Real Readiness +
 * Live Smoke Tests", section 5) — enrichissement d'identité GÉNÉRAL par
 * identifiant EXACT uniquement (GTIN, `wdt:P3962`) : JAMAIS de recherche
 * SPARQL large/floue par texte (règle absolue du lot). Couverture GTIN
 * attendue CLAIRSEMÉE hors marques grand public bien référencées (audit
 * ce lot) — un connecteur d'ENRICHISSEMENT complémentaire, jamais une
 * source de lookup barcode primaire (voir Open Food Facts/Open Products
 * Facts pour ce rôle). Aucun prix — CC0, aucune clé API.
 */
export function createWikidataCatalogConnector(config: WikidataCatalogConfig = {}): CatalogConnector {
  const client = createWikidataClient(config);
  const defaultCategorySlug = config.categorySlug ?? "general";

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "wikidata",
    displayName: "Wikidata",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: "any",
    declaredQuality: {
      // Déclaré à l'écriture du connecteur (audit + smoke test réel ce
      // lot, GTIN `00640520098905` -> "Apple iPhone 7 128GB Jet Black")
      // — coverage volontairement bas : GTIN clairsemé hors grandes
      // marques (audit confirmé), jamais surestimé.
      reliability: 65,
      coverage: 25,
      freshness: 40,
      latency: 55,
      confidence: 70,
    },
    cost: { model: "free", details: "Gratuit, CC0, aucune clé API, aucune authentification (confirmé par appel réel)." },
    quotas: {
      perSecond: 1,
      notes: "Étiquette opérationnelle Wikidata (audit ce lot) : requêtes SÉRIELLES, jamais parallèles ; limites SPARQL documentées ~60s de temps de requête/minute/IP, 5 requêtes concurrentes max — non appliquées par ce client lui-même, responsabilité de l'appelant.",
    },
    license: {
      // Confirmé par audit ce lot (wikidata.org/wiki/Wikidata:REST_API) :
      // CC0 — aucune attribution légalement requise (coutume communautaire
      // uniquement), aucune restriction d'usage commercial.
      allowsCommercialUse: true,
      allowsCaching: true,
      maxCacheAgeHours: 168,
      allowsRedistribution: true,
      termsUrl: "https://www.wikidata.org/wiki/Wikidata:REST_API",
    },
    cachePolicy: { ttlHours: 168, staleWhileRevalidate: true },
  };

  async function resolve(query: CatalogQuery): Promise<CatalogMatch[]> {
    const hints = isHints(query.hints) ? (query.hints as WikidataCatalogHints) : {};
    if (!hints.gtin) return [];

    const raw = await client.query(buildExactGtinQuery(hints.gtin));
    const parsed = sparqlResultsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse SPARQL Wikidata invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    return matchSparqlGtinResults(parsed.data, hints.gtin, query.categorySlug || defaultCategorySlug);
  }

  async function getItem(externalId: string): Promise<CatalogItem | null> {
    // Pas de lookup direct par ID Wikidata implémenté ce lot (jamais
    // demandé, hors scope du brief section 5) — `resolve()` (par GTIN
    // exact) est le seul point d'entrée réel de ce connecteur.
    void externalId;
    return null;
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      // GTIN connu réel (audit/smoke test ce lot) — un succès HTTP,
      // même avec `bindings: []`, confirme que le service RÉPOND.
      await client.query(buildExactGtinQuery("00640520098905"));
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Échec inconnu de Wikidata.",
      };
    }
  }

  return { ...descriptor, resolve, getItem, healthCheck };
}
