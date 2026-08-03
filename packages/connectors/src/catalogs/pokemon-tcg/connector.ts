import type {
  CatalogConnector,
  CatalogItem,
  CatalogMatch,
  CatalogQuery,
  ConnectorDescriptor,
  HealthCheckResult,
} from "../../types";
import { ConnectorError } from "../../types";
import type { TcgCatalogHints, TcgProductKind } from "../tcg/types";
import { createPokemonTcgHttpClient, type PokemonTcgClientOptions } from "./client";
import { normalizePokemonTcgCard, matchCard } from "./normalize";
import { pokemonTcgSearchResponseSchema, pokemonTcgGetCardResponseSchema } from "./raw-types";

export interface PokemonTcgConnectorConfig extends PokemonTcgClientOptions {
  /** Catégorie DealRadar que ce connecteur sert — jamais déduite du format source. */
  categorySlug?: string;
}

/**
 * Kinds que ce connecteur peut honnêtement résoudre. La Pokémon TCG API ne
 * couvre que les cartes seules (confirmé par appel réel à l'API, aucun
 * produit scellé dans le schéma) — jamais de prétention à identifier un
 * booster/display/ETB/tin/coffret/bundle, jamais un état gradé précis (la
 * carte peut être identifiée, pas le grade d'un exemplaire).
 */
const SUPPORTED_KINDS: readonly TcgProductKind[] = ["raw_card"];

function isHints(value: unknown): value is TcgCatalogHints {
  return typeof value === "object" && value !== null;
}

/** Un zéro de tête suivi d'au moins un autre chiffre — jamais retiré au-delà (voir le second essai dans `resolve()`). */
const LEADING_ZEROS = /^0+(?=[0-9])/;

function buildSearchQuery(hints: TcgCatalogHints): string | null {
  const clauses: string[] = [];
  if (hints.name) clauses.push(`name:"${hints.name}"`);
  if (hints.setName) clauses.push(`set.name:"${hints.setName}"`);
  if (hints.setCode) clauses.push(`set.id:${hints.setCode}`);
  // Jamais un "/" brut dans une clause Lucene : confirmé par appel réel le
  // 2026-08-03 (`number:58/102` → 400 Bad Request) — un `collectorNumber` qui
  // en porte encore un (format non reconnu par `deriveCollectorNumberForCatalogQuery`)
  // est ignoré ici plutôt que deviné ou coupé arbitrairement.
  if (hints.collectorNumber && !hints.collectorNumber.includes("/")) clauses.push(`number:${hints.collectorNumber}`);
  return clauses.length > 0 ? clauses.join(" ") : null;
}

/**
 * Catalog Connector Pokémon TCG API (ADR 0012) — résout des indices en
 * identité canonique de carte. Capacité versionnée `catalog.resolve.v1`.
 * Ne déclare jamais pouvoir identifier un produit scellé ou un grade précis
 * — voir `resolve()`.
 */
export function createPokemonTcgCatalogConnector(config: PokemonTcgConnectorConfig = {}): CatalogConnector {
  const client = createPokemonTcgHttpClient(config);
  const categorySlug = config.categorySlug ?? "pokemon_tcg";

  const descriptor: Omit<ConnectorDescriptor, "healthCheck"> = {
    source: "pokemon-tcg-api",
    displayName: "Pokémon TCG API",
    family: "catalog",
    capabilities: ["catalog.resolve.v1"],
    supportedCategorySlugs: [categorySlug],
    declaredQuality: {
      // Déclaré à l'écriture du connecteur (aucune télémétrie observée encore) : API
      // publique stable, mais couverture volontairement limitée aux cartes seules.
      reliability: 80,
      coverage: 40,
      freshness: 70,
      latency: 70,
      confidence: 60,
    },
    cost: { model: "freemium", details: "Gratuit ; clé API optionnelle relevant le quota (1 000 → 20 000/jour)." },
    quotas: { perDay: 20000, notes: "20 000/jour avec clé API, 1 000/jour sans (non vérifié empiriquement, source : documentation officielle)." },
    license: {
      // Non confirmé : CGU inaccessibles (403) au moment de l'implémentation — jamais
      // une permission supposée favorable. À revérifier avant tout usage commercial élargi.
      allowsCommercialUse: false,
      allowsCaching: true,
      maxCacheAgeHours: 24,
      allowsRedistribution: false,
      termsUrl: "https://docs.pokemontcg.io/",
    },
    cachePolicy: { ttlHours: 24, staleWhileRevalidate: true },
  };

  async function searchCards(q: string, hints: TcgCatalogHints): Promise<CatalogMatch[]> {
    const raw = await client.get("/cards", { q, pageSize: 10 });
    const parsed = pokemonTcgSearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Pokémon TCG API invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    return parsed.data.data
      .map((card) => matchCard(card, hints))
      .map((match) => ({ ...match, item: { ...match.item, categorySlug } }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  async function resolve(query: CatalogQuery): Promise<CatalogMatch[]> {
    const hints = isHints(query.hints) ? (query.hints as TcgCatalogHints) : {};

    // Refus honnête : kind explicitement scellé ou gradé — hors de portée de ce
    // catalogue, jamais une correspondance devinée. Cf. ADR 0012 "aucune donnée inventée".
    if (hints.kind && !SUPPORTED_KINDS.includes(hints.kind)) {
      return [];
    }

    const q = buildSearchQuery(hints);
    if (!q) return [];

    const matches = await searchCards(q, hints);
    if (matches.length > 0) return matches;

    // Second essai, propre à ce connecteur : le numérateur peut porter un zéro
    // de tête que l'index de la Pokémon TCG API ne reconnaît pas toujours (non
    // prouvé universel — voir rapport du 2026-08-03). Ne retire QUE le zéro de
    // tête, jamais une autre transformation ; ne s'applique jamais au nom/set
    // ni à un `collectorNumber` déjà sans zéro de tête ou alphanumérique.
    if (hints.collectorNumber && LEADING_ZEROS.test(hints.collectorNumber)) {
      const strippedHints: TcgCatalogHints = { ...hints, collectorNumber: hints.collectorNumber.replace(LEADING_ZEROS, "") };
      const retryQ = buildSearchQuery(strippedHints);
      if (retryQ) return searchCards(retryQ, strippedHints);
    }

    return matches;
  }

  async function getItem(externalId: string): Promise<CatalogItem | null> {
    let raw: unknown;
    try {
      raw = await client.get(`/cards/${encodeURIComponent(externalId)}`);
    } catch (error) {
      if (error instanceof ConnectorError && error.httpStatus === 404) return null;
      throw error;
    }

    const parsed = pokemonTcgGetCardResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConnectorError(`Réponse Pokémon TCG API invalide : ${parsed.error.issues[0]?.message ?? "erreur de validation"}`, {
        retryable: false,
      });
    }

    return normalizePokemonTcgCard(parsed.data.data, categorySlug);
  }

  async function healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    try {
      await client.get("/cards", { pageSize: 1 });
      return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: "down",
        checkedAt,
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Échec inconnu de la Pokémon TCG API.",
      };
    }
  }

  return { ...descriptor, resolve, getItem, healthCheck };
}
