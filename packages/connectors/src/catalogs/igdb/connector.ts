import type { CatalogConnector, CatalogItem, CatalogMatch, CatalogQuery, ConnectorDescriptor, HealthCheckResult } from "../../types";
import { ConnectorError } from "../../types";
import { createIgdbClient, type IgdbClientOptions } from "./client";
import { matchIgdbGame, normalizeIgdbGame } from "./normalize";
import { igdbGameListSchema } from "./raw-types";

export interface IgdbCatalogHints {
  title?: string;
}

function isHints(value: unknown): value is IgdbCatalogHints {
  return typeof value === "object" && value !== null;
}

function escapeApicalypseString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const FIELDS = "id,name,slug,first_release_date,cover.url,platforms.name";

export interface IgdbCatalogConfig extends IgdbClientOptions {
  categorySlug?: string;
}

/**
 * Catalog Connector IGDB (LOT "Free/Open Sources + Real Readiness + Live
 * Smoke Tests", section 7) — enrichissement d'identité JEUX VIDÉO
 * uniquement (titre, plateformes, date de sortie), jamais un prix.
 *
 * **VERROUILLÉ EN PRODUCTION — `license.allowsCommercialUse: false`
 * intentionnel.** Audit ce lot (Twitch Developer Services Agreement +
 * forum développeur Twitch) : IGDB/Twitch distinguent explicitement
 * l'usage non-commercial/hobby (palier par défaut, gratuit) d'un usage
 * commercial en production avec de vrais utilisateurs, pour lequel un
 * accord commercial signé via `partner@igdb.com` est attendu. Documentation
 * primaire (`api-docs.igdb.com`) inaccessible (403) pendant l'audit — les
 * conditions EXACTES (frais, part de revenu, ou simple approbation) restent
 * NON confirmées. Voir `source-readiness-matrix.ts` : `policyStatus:
 * "license_required"`, `productionAllowed: false`, MÊME discipline que
 * PriceCharting/WatchCharts — une credential valide seule ne suffit
 * JAMAIS à activer cette source, un changement de politique explicite dans
 * la matrice est requis en plus.
 */
export function createIgdbCatalogConnector(config: IgdbCatalogConfig): CatalogConnector {
  const client = createIgdbClient(config);
  const categorySlug = config.categorySlug ?? "gaming";

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "igdb",
    displayName: "IGDB",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: ["gaming"],
    declaredQuality: {
      // Déclaré à l'écriture du connecteur (audit ce lot) — AUCUN appel
      // authentifié réel effectué (IGDB_CLIENT_ID/SECRET absentes) :
      // chiffres bas et prudents, jamais optimistes sans preuve.
      reliability: 40,
      coverage: 60,
      freshness: 45,
      latency: 55,
      confidence: 35,
    },
    cost: { model: "freemium", details: "Palier gratuit non-commercial confirmé ; usage commercial en production semble nécessiter un accord distinct via partner@igdb.com (audit ce lot, jamais confirmé contre la documentation primaire — 403 pendant l'audit)." },
    quotas: { perSecond: 4, notes: "4 requêtes/seconde, 8 requêtes concurrentes maximum pour le palier par défaut (chiffres corroborés par de multiples sources secondaires ce lot, jamais confirmés contre api-docs.igdb.com directement — inaccessible)." },
    license: {
      allowsCommercialUse: false,
      allowsCaching: true,
      maxCacheAgeHours: 168,
      allowsRedistribution: false,
      termsUrl: "https://legal.twitch.tv/legal/developer-agreement/",
    },
    cachePolicy: { ttlHours: 168, staleWhileRevalidate: true },
  };

  async function resolve(query: CatalogQuery): Promise<CatalogMatch[]> {
    const hints = isHints(query.hints) ? (query.hints as IgdbCatalogHints) : {};
    if (!hints.title) return [];

    // Correspondance EXACTE sur le titre (`where name = "..."`) — jamais
    // `~` (contient, flou) côté Apicalypse pour ce lot, conformément à la
    // discipline "exact/unambiguous identifiers only" du brief.
    const body = `fields ${FIELDS}; where name = "${escapeApicalypseString(hints.title)}"; limit 10;`;
    const raw = await client.post("/games", body);
    const parsed = igdbGameListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse IGDB invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    return parsed.data.map((game) => matchIgdbGame(game, query.categorySlug || categorySlug));
  }

  async function getItem(externalId: string): Promise<CatalogItem | null> {
    const body = `fields ${FIELDS}; where id = ${Number(externalId)}; limit 1;`;
    const raw = await client.post("/games", body);
    const parsed = igdbGameListSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse IGDB invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, { retryable: false });
    }
    const [game] = parsed.data;
    return game ? normalizeIgdbGame(game, categorySlug) : null;
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      await client.post("/games", `fields id; limit 1;`);
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Échec inconnu d'IGDB.",
      };
    }
  }

  return { ...descriptor, resolve, getItem, healthCheck };
}
