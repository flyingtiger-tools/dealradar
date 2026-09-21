import type { MarketObservation, MarketSource, MarketSourceQuery } from "@dealradar/connectors";
import { marketObservationDedupeKey, dedupeByCanonicalOrigin } from "@dealradar/connectors";

/**
 * Orchestrateur multi-source (LOT "Multi-Source Market Intelligence
 * Foundation") — généralise `gather-active-listing-evidence.ts` (une seule
 * source, eBay) à N sources hétérogènes (`MarketSource`, `@dealradar/
 * connectors`). Aucune source n'est jamais obligatoire : une source qui
 * échoue ou dépasse son budget de temps ne fait jamais échouer les autres
 * ni l'analyse globale — voir `diagnostics` pour savoir précisément ce qui
 * s'est passé pour chacune.
 *
 * Concurrence bornée volontairement simple (une file de N en vol max, pas
 * de dépendance externe) — suffisant pour le nombre de sources réalistes
 * par catégorie (voir `source-routing.ts`, rarement plus de 5-6 entrées).
 */

export interface AggregateMarketObservationsInput {
  categorySlug: string;
  /** Sources déjà résolues/ordonnées pour cette catégorie (voir `resolveSourcesForCategory`, `@dealradar/connectors`) — cette fonction ne fait aucun choix de routage elle-même. */
  sources: readonly MarketSource[];
  q: string;
  hints?: Record<string, unknown>;
  country?: string;
  limitPerSource?: number;
  /** Nombre maximal de sources interrogées EN PARALLÈLE — jamais toutes en même temps sans borne, même avec un petit nombre de sources. */
  maxConcurrency?: number;
  /** Budget de temps par source — une source qui dépasse est traitée comme un échec, jamais bloquant pour les autres. */
  perSourceTimeoutMs?: number;
}

export type SourceDiagnosticStatus = "success" | "error" | "timeout";

export interface SourceDiagnostic {
  source: string;
  status: SourceDiagnosticStatus;
  observationCount: number;
  latencyMs: number;
  /** `undefined` si `status === "success"` — jamais un détail technique brut exposé au-delà du message d'erreur déjà nettoyé par le connecteur (même discipline que le reste du repo, ex. `ConnectorError`). */
  errorMessage?: string;
}

export interface AggregateMarketObservationsResult {
  /**
   * Dédoublonnées entre ET au sein des sources (voir
   * `marketObservationDedupeKey`) PUIS par origine canonique inter-
   * connecteurs (LOT "Source Wave 3", section 7 — voir
   * `dedupeByCanonicalOrigin`, `@dealradar/connectors` : deux agrégateurs
   * larges différents, ex. SerpApi et DataForSEO, qui restituent la MÊME
   * offre réelle d'un même marchand ne comptent jamais deux fois).
   */
  observations: MarketObservation[];
  /** Nombre d'observations fusionnées par le passage de dédoublonnage par origine canonique — `0` si aucun doublon inter-connecteur détecté, jamais un signal silencieux. */
  canonicalOriginMergedCount: number;
  diagnostics: SourceDiagnostic[];
}

const DEFAULT_MAX_CONCURRENCY = 3;
const DEFAULT_PER_SOURCE_TIMEOUT_MS = 10_000;

class SourceTimeoutError extends Error {
  constructor() {
    super("Délai dépassé pour cette source.");
    this.name = "SourceTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => reject(new SourceTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutHandle);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutHandle);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function runOneSource(
  source: MarketSource,
  query: MarketSourceQuery,
  timeoutMs: number,
): Promise<{ diagnostic: SourceDiagnostic; observations: MarketObservation[] }> {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(source.search(query), timeoutMs);
    return {
      diagnostic: { source: source.source, status: "success", observationCount: result.observations.length, latencyMs: Date.now() - startedAt },
      observations: result.observations,
    };
  } catch (error) {
    const isTimeout = error instanceof SourceTimeoutError;
    return {
      diagnostic: {
        source: source.source,
        status: isTimeout ? "timeout" : "error",
        observationCount: 0,
        latencyMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : "Erreur inconnue.",
      },
      observations: [],
    };
  }
}

/** File à concurrence bornée — traite `items` avec au plus `maxConcurrency` exécutions de `task` en vol simultanément, préserve l'ordre des résultats. */
async function mapWithBoundedConcurrency<T, R>(items: readonly T[], maxConcurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!);
    }
  }

  const workerCount = Math.max(1, Math.min(maxConcurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function aggregateMarketObservations(input: AggregateMarketObservationsInput): Promise<AggregateMarketObservationsResult> {
  const maxConcurrency = input.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const perSourceTimeoutMs = input.perSourceTimeoutMs ?? DEFAULT_PER_SOURCE_TIMEOUT_MS;

  const query: MarketSourceQuery = {
    categorySlug: input.categorySlug,
    q: input.q,
    hints: input.hints,
    country: input.country,
    limit: input.limitPerSource,
  };

  const perSourceResults = await mapWithBoundedConcurrency(input.sources, maxConcurrency, (source) => runOneSource(source, query, perSourceTimeoutMs));

  const diagnostics = perSourceResults.map((r) => r.diagnostic);

  const seen = new Set<string>();
  const dedupedByKey: MarketObservation[] = [];
  for (const { observations: sourceObservations } of perSourceResults) {
    for (const observation of sourceObservations) {
      const key = marketObservationDedupeKey(observation);
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedByKey.push(observation);
    }
  }

  const { observations, mergedCount: canonicalOriginMergedCount } = dedupeByCanonicalOrigin(dedupedByKey);

  return { observations, canonicalOriginMergedCount, diagnostics };
}
