import type { CatalogConnector, CatalogItem, CatalogMatch, CatalogQuery, ConnectorDescriptor, HealthCheckResult } from "../../types";
import { ConnectorError } from "../../types";
import type { TcgCatalogHints, TcgProductKind } from "../tcg/types";
import { createTcgdexHttpClient, type TcgdexClientOptions } from "./client";
import { matchTcgdexCard, normalizeTcgdexCard, resolveTcgdexLanguage } from "./normalize";
import { tcgdexCardListSchema, tcgdexCardSchema } from "./raw-types";

export interface TcgdexConnectorConfig extends TcgdexClientOptions {
  categorySlug?: string;
}

/**
 * TCGdex ne modélise que la carte seule (confirmé par appel réel — aucun
 * champ scellé/gradé dans le schéma) — même refus honnête que le Catalog
 * Connector Pokémon TCG API.
 */
const SUPPORTED_KINDS: readonly TcgProductKind[] = ["raw_card"];

function isHints(value: unknown): value is TcgCatalogHints {
  return typeof value === "object" && value !== null;
}

/**
 * Catalog Connector TCGdex (ADR 0012, LOT 7B) — source complémentaire au
 * Catalog Connector Pokémon TCG API, jamais un remplacement : les deux
 * restent enregistrables séparément (même `source`, familles différentes —
 * voir la correction d'unicité du Registry, LOT 7B). Capacité versionnée
 * `catalog.resolve.v1`.
 */
export function createTcgdexCatalogConnector(config: TcgdexConnectorConfig = {}): CatalogConnector {
  const client = createTcgdexHttpClient(config);
  const categorySlug = config.categorySlug ?? "pokemon_tcg";

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "tcgdex",
    displayName: "TCGdex",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: [categorySlug],
    declaredQuality: {
      // Déclaré à l'écriture du connecteur : API publique stable, catalogue
      // multilingue riche, mais aucune télémétrie observée encore.
      reliability: 75,
      coverage: 60,
      freshness: 70,
      latency: 65,
      confidence: 55,
    },
    cost: { model: "free", details: "Gratuit, aucune clé API, aucun quota documenté (confirmé par appel réel à api.tcgdex.net)." },
    quotas: {},
    license: {
      // Confirmé : dépôt cards-database sous licence MIT (github.com/tcgdex/cards-database/blob/master/LICENSE).
      allowsCommercialUse: true,
      allowsCaching: true,
      maxCacheAgeHours: 24,
      allowsRedistribution: true,
      termsUrl: "https://github.com/tcgdex/cards-database/blob/master/LICENSE",
    },
    cachePolicy: { ttlHours: 24, staleWhileRevalidate: true },
  };

  async function resolve(query: CatalogQuery): Promise<CatalogMatch[]> {
    const hints = isHints(query.hints) ? (query.hints as TcgCatalogHints) : {};

    if (hints.kind && !SUPPORTED_KINDS.includes(hints.kind)) return [];

    const language = resolveTcgdexLanguage(hints.language);
    const filters: Record<string, string> = {};
    if (hints.name) filters.name = `eq:${hints.name}`;
    if (hints.setCode) filters["set.id"] = `eq:${hints.setCode}`;
    if (hints.collectorNumber) filters.localId = `eq:${hints.collectorNumber}`;
    if (Object.keys(filters).length === 0) return [];

    const rawList = await client.get(language, "/cards", filters);
    const parsedList = tcgdexCardListSchema.safeParse(rawList);
    if (!parsedList.success) {
      throw new ConnectorError(`Réponse TCGdex invalide : ${parsedList.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    // La recherche ne renvoie qu'un résumé (id/localId/name/image) — jamais
    // assez pour matcher honnêtement (set, rareté). Chaque candidat est
    // récupéré en détail avant toute correspondance.
    const detailed = await Promise.all(
      parsedList.data.map(async (brief) => {
        const raw = await client.get(language, `/cards/${encodeURIComponent(brief.id)}`);
        const parsed = tcgdexCardSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      }),
    );

    return detailed
      .filter((card): card is NonNullable<typeof card> => card !== null)
      .map((card) => matchTcgdexCard(card, hints, language))
      .map((match) => ({ ...match, item: { ...match.item, categorySlug } }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  async function getItem(externalId: string): Promise<CatalogItem | null> {
    let raw: unknown;
    try {
      raw = await client.get("en", `/cards/${encodeURIComponent(externalId)}`);
    } catch (error) {
      if (error instanceof ConnectorError && error.httpStatus === 404) return null;
      throw error;
    }

    const parsed = tcgdexCardSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse TCGdex invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    return normalizeTcgdexCard(parsed.data, categorySlug, "en");
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      await client.get("en", "/cards", { "pagination:itemsPerPage": 1 });
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Échec inconnu de TCGdex.",
      };
    }
  }

  return { ...descriptor, resolve, getItem, healthCheck };
}
