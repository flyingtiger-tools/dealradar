import type { ConnectorDescriptor, HealthCheckResult, NormalizedPriceObservation, PricingConnector, PricingQuery } from "../../types";
import { ConnectorError } from "../../types";
import type { TcgCatalogHints, TcgProductKind } from "../../catalogs/tcg/types";
import { createTcgdexHttpClient, type TcgdexClientOptions } from "../../catalogs/tcgdex/client";
import { resolveTcgdexLanguage } from "../../catalogs/tcgdex/normalize";
import { tcgdexCardListSchema, tcgdexCardSchema } from "../../catalogs/tcgdex/raw-types";
import { normalizeTcgdexPricing } from "./normalize";

export interface TcgdexPricingConnectorConfig extends TcgdexClientOptions {
  categorySlug?: string;
}

/** Même refus honnête que le Catalog Connector TCGdex — aucun prix scellé/gradé dans le schéma. */
const SUPPORTED_KINDS: readonly TcgProductKind[] = ["raw_card"];

function isHints(value: unknown): value is TcgCatalogHints {
  return typeof value === "object" && value !== null;
}

/**
 * Pricing Connector TCGdex (ADR 0012, LOT 7B) — Cardmarket (EUR) et
 * TCGPlayer (USD), deuxième source de corroboration à côté de JustTCG.
 * Capacité versionnée `pricing.lookup.v1`. Partage le client HTTP avec le
 * Catalog Connector TCGdex (même API), jamais une source distincte.
 */
export function createTcgdexPricingConnector(config: TcgdexPricingConnectorConfig = {}): PricingConnector {
  const client = createTcgdexHttpClient(config);
  const categorySlug = config.categorySlug ?? "pokemon_tcg";

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "tcgdex",
    displayName: "TCGdex",
    family: "pricing",
    capabilities: ["pricing.lookup.v1"],
    supportedCategorySlugs: [categorySlug],
    declaredQuality: {
      reliability: 75,
      coverage: 55,
      freshness: 70,
      latency: 65,
      confidence: 55,
    },
    cost: { model: "free", details: "Gratuit, aucune clé API." },
    quotas: {},
    license: {
      allowsCommercialUse: true,
      allowsCaching: true,
      maxCacheAgeHours: 24,
      allowsRedistribution: true,
      termsUrl: "https://github.com/tcgdex/cards-database/blob/master/LICENSE",
    },
    cachePolicy: { ttlHours: 12, staleWhileRevalidate: true },
  };

  async function lookup(query: PricingQuery): Promise<NormalizedPriceObservation[]> {
    const hints = isHints(query.hints) ? (query.hints as TcgCatalogHints) : {};

    if (hints.kind && !SUPPORTED_KINDS.includes(hints.kind)) return [];
    if (!hints.name && !hints.setCode && !hints.collectorNumber) return [];

    const language = resolveTcgdexLanguage(hints.language);
    const filters: Record<string, string> = {};
    if (hints.name) filters.name = `eq:${hints.name}`;
    if (hints.setCode) filters["set.id"] = `eq:${hints.setCode}`;
    if (hints.collectorNumber) filters.localId = `eq:${hints.collectorNumber}`;

    const rawList = await client.get(language, "/cards", filters);
    const parsedList = tcgdexCardListSchema.safeParse(rawList);
    if (!parsedList.success) {
      throw new ConnectorError(`Réponse TCGdex invalide : ${parsedList.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    const detailed = await Promise.all(
      parsedList.data.map(async (brief) => {
        const raw = await client.get(language, `/cards/${encodeURIComponent(brief.id)}`);
        const parsed = tcgdexCardSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      }),
    );

    return detailed.filter((card): card is NonNullable<typeof card> => card !== null).flatMap((card) => normalizeTcgdexPricing(card, hints, language));
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

  return { ...descriptor, lookup, healthCheck };
}
