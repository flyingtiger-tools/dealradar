import {
  createOpenFoodFactsCatalogConnector,
  createOpenProductsFactsCatalogConnector,
  createRebrickableCatalogConnector,
  createUpcDevCatalogConnector,
  createWikidataCatalogConnector,
  SOURCE_READINESS_MATRIX,
  resolveSourceReadiness,
  type CatalogConnector,
  type CatalogMatch,
} from "@dealradar/connectors";
import type { CatalogLookupFn } from "@dealradar/ingestion";
import type { IdentityHints } from "@dealradar/ingestion";
import { logger } from "../logger";

/**
 * Usine de sources CATALOGUE (LOT "Live Identity Enrichment + Barcode-First
 * + upc.dev Fallback + Railway Readiness", section 1) — même discipline
 * que `market-source-factory.ts` (MarketSource) : construit tout ce qui
 * est DISPONIBLE depuis l'environnement, une source manquante/verrouillée
 * ne bloque jamais les autres. Consulte `SOURCE_READINESS_MATRIX` de la
 * MÊME façon que `buildMarketSourcesFromEnv` — un verrou de politique
 * (`productionAllowed: false`, ex. IGDB) empêche TOUJOURS la construction,
 * même si une credential valide est présente.
 *
 * `igdb` n'est PAS construit ici (aucun appel à
 * `createIgdbCatalogConnector`) — jamais construit du tout tant que
 * `productionAllowed: false` dans la matrice, conformément à la section 9
 * du brief ("Do not ask user to create IGDB credentials yet if commercial
 * approval is still the actual blocker").
 *
 * `upcdev` (LOT "Live Identity Enrichment + Barcode-First + upc.dev
 * Fallback + Railway Readiness", section 3) suit EXACTEMENT le même patron
 * de portillon que `rebrickable` (`UPCDEV_API_KEY` requise, jamais
 * construit sans elle) — jamais un appel réseau juste pour vérifier la
 * clé, `createUpcDevCatalogConnector` reste une construction pure locale.
 */
export interface CatalogSourceDiagnosticEntry {
  name: string;
  enabled: boolean;
  readiness?: string;
}

export interface BuildCatalogSourcesResult {
  sources: Map<string, CatalogConnector>;
  diagnostics: CatalogSourceDiagnosticEntry[];
}

function readinessFor(name: string): string | undefined {
  const descriptor = SOURCE_READINESS_MATRIX.find((d) => d.source === name);
  if (!descriptor) return undefined;
  const envPresence: Record<string, boolean> = {};
  for (const envVar of descriptor.requiredEnvVars) envPresence[envVar] = Boolean(process.env[envVar]);
  return resolveSourceReadiness(descriptor, envPresence);
}

function isConstructionAllowed(name: string, readiness: string | undefined): boolean {
  if (readiness === undefined) return true;
  const descriptor = SOURCE_READINESS_MATRIX.find((d) => d.source === name);
  if (descriptor && !descriptor.productionAllowed) return false;
  return readiness !== "restricted" && readiness !== "disabled_policy" && readiness !== "license_required";
}

function tryBuild(name: string, build: () => CatalogConnector | null): { source: CatalogConnector | null; diagnostic: CatalogSourceDiagnosticEntry } {
  const readiness = readinessFor(name);
  if (!isConstructionAllowed(name, readiness)) {
    logger.warn({ name, readiness }, `Source catalogue "${name}" verrouillée par la politique de préparation — jamais construite`);
    return { source: null, diagnostic: { name, enabled: false, readiness } };
  }
  try {
    const source = build();
    return { source, diagnostic: { name, enabled: source !== null, readiness } };
  } catch (error) {
    logger.warn({ name, error: error instanceof Error ? error.message : "erreur inconnue" }, `Source catalogue "${name}" non construite depuis l'environnement`);
    return { source: null, diagnostic: { name, enabled: false, readiness } };
  }
}

export function buildCatalogSourcesFromEnv(): BuildCatalogSourcesResult {
  const results = [
    tryBuild("open_food_facts", () => createOpenFoodFactsCatalogConnector()),
    tryBuild("open_products_facts", () => createOpenProductsFactsCatalogConnector()),
    tryBuild("wikidata", () => createWikidataCatalogConnector()),
    tryBuild("rebrickable", () => {
      const apiKey = process.env.REBRICKABLE_API_KEY;
      if (!apiKey) return null;
      return createRebrickableCatalogConnector({ apiKey });
    }),
    tryBuild("upcdev", () => {
      const apiKey = process.env.UPCDEV_API_KEY;
      if (!apiKey) return null;
      return createUpcDevCatalogConnector({ apiKey });
    }),
  ];

  const sources = new Map<string, CatalogConnector>();
  for (const r of results) if (r.source) sources.set(r.source.source, r.source);

  return { sources, diagnostics: results.map((r) => r.diagnostic) };
}

/**
 * Adapte les connecteurs construits en `CatalogLookupFn` (`@dealradar/
 * ingestion`) — traduit les `IdentityHints` génériques en hints propres à
 * chaque connecteur (`barcode`/`setNumber`/`gtin`), jamais un couplage
 * inverse (`enrich-product-identity.ts` ne connaît RIEN de la forme
 * réelle des hints par connecteur).
 */
export function createCatalogLookup(sources: Map<string, CatalogConnector>): CatalogLookupFn {
  return async (source: string, hints: IdentityHints, categorySlug: string): Promise<CatalogMatch[]> => {
    const connector = sources.get(source);
    if (!connector) return [];

    if (source === "open_food_facts" || source === "open_products_facts") {
      if (!hints.barcode) return [];
      return connector.resolve({ categorySlug, hints: { barcode: hints.barcode } });
    }
    if (source === "wikidata") {
      if (!hints.barcode) return [];
      return connector.resolve({ categorySlug, hints: { gtin: hints.barcode } });
    }
    if (source === "rebrickable") {
      if (!hints.legoSetNumber) return [];
      return connector.resolve({ categorySlug, hints: { setNumber: hints.legoSetNumber } });
    }
    if (source === "upcdev") {
      if (!hints.barcode) return [];
      return connector.resolve({ categorySlug, hints: { upc: hints.barcode } });
    }
    return [];
  };
}

/**
 * Couche de cache PARTAGÉE, bornée en taille (LOT "Live Identity
 * Enrichment + Barcode-First + upc.dev Fallback + Railway Readiness",
 * section 11) — clé par SOURCE + IDENTIFIANT EXACT, jamais par un texte
 * flou. TTL PAR SOURCE réutilisé TEL QUEL depuis le `cachePolicy.ttlHours`
 * DÉJÀ déclaré par chaque connecteur (`ConnectorDescriptor`, `@dealradar/
 * connectors`) — jamais une seconde politique de durée inventée ici en
 * parallèle. Un connecteur dont la licence ne permet PAS la mise en cache
 * (`license.allowsCaching: false`, aucun cas aujourd'hui mais vérifié
 * défensivement) n'est JAMAIS mis en cache, quel que soit le résultat.
 *
 * Cache NÉGATIF (`matches.length === 0`) plafonné à
 * `NEGATIVE_CACHE_TTL_HOURS` (24h) INDÉPENDAMMENT du TTL positif du
 * connecteur — un "non trouvé" peut redevenir vrai plus tôt qu'un TTL
 * positif de 720h (upc.dev) ne le suggérerait, jamais un blocage
 * permanent d'un produit qui vient d'être ajouté à la base amont.
 *
 * Une PANNE (exception levée par `lookup`) n'est JAMAIS mise en cache —
 * l'exception se propage AVANT d'atteindre le code de mise en cache
 * ci-dessous, garantissant qu'un appel suivant réessaie normalement
 * (retry/backoff déjà géré PAR CHAQUE client HTTP individuellement, cette
 * couche ne fait que réduire le VOLUME d'appels répétés pour le même
 * identifiant, jamais une seconde couche de retry).
 *
 * Taille bornée (`MAX_CACHE_ENTRIES`, éviction FIFO via l'ordre
 * d'insertion naturel d'un `Map`) — un worker de longue durée (pg-boss)
 * ne doit jamais voir sa mémoire croître sans limite.
 */
const DEFAULT_POSITIVE_TTL_HOURS = 24;
const NEGATIVE_CACHE_TTL_HOURS = 24;
const MAX_CACHE_ENTRIES = 2000;

interface CatalogLookupCacheEntry {
  matches: CatalogMatch[];
  expiresAt: number;
}

export type CatalogLookupCache = Map<string, CatalogLookupCacheEntry>;

export function createCatalogLookupCache(): CatalogLookupCache {
  return new Map();
}

/** Un seul indice pertinent par appel en pratique (voir `createCatalogLookup`) — inclure les trois dans la clé reste sûr et déterministe, jamais un couplage à l'ordre des propriétés d'un objet. */
function cacheKey(source: string, hints: IdentityHints): string {
  return `${source}::${hints.barcode ?? ""}::${hints.legoSetNumber ?? ""}::${hints.gamingTitle ?? ""}`;
}

export function wrapCatalogLookupWithCache(lookup: CatalogLookupFn, sources: Map<string, CatalogConnector>, cache: CatalogLookupCache = createCatalogLookupCache()): CatalogLookupFn {
  return async (source: string, hints: IdentityHints, categorySlug: string): Promise<CatalogMatch[]> => {
    const key = cacheKey(source, hints);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.matches;

    const matches = await lookup(source, hints, categorySlug);

    const connector = sources.get(source);
    if (connector && !connector.license.allowsCaching) return matches;

    const positiveTtlHours = connector?.cachePolicy.ttlHours ?? DEFAULT_POSITIVE_TTL_HOURS;
    const ttlHours = matches.length > 0 ? positiveTtlHours : Math.min(positiveTtlHours, NEGATIVE_CACHE_TTL_HOURS);

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(key, { matches, expiresAt: now + ttlHours * 3_600_000 });
    return matches;
  };
}

/** Composition PRÊTE À L'EMPLOI pour l'appelant réel (`process-analysis.ts`) — jamais l'appelant ne compose `createCatalogLookup`/`wrapCatalogLookupWithCache` lui-même, pour ne pas risquer d'oublier la couche de cache à un futur site d'appel. */
export function createCachedCatalogLookup(sources: Map<string, CatalogConnector>, cache?: CatalogLookupCache): CatalogLookupFn {
  return wrapCatalogLookupWithCache(createCatalogLookup(sources), sources, cache);
}

/**
 * Cache partagé du process workers, au niveau MODULE — même précédent
 * exact que `sharedFxRateProvider` (`fx-provider.ts`) : un seul processus
 * workers sert potentiellement de nombreuses analyses, le cache doit
 * survivre ENTRE elles, jamais recréé à chaque appel (`buildCatalogSourcesFromEnv()`
 * reste, lui, reconstruit à chaque appel — construction locale pure, aucun
 * coût réseau — mais le CACHE de résultats doit être le même point de
 * vérité unique à travers tous les appels).
 */
export const sharedCatalogLookupCache: CatalogLookupCache = createCatalogLookupCache();
