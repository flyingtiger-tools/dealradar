import { createDataForSeoClient, type DataForSeoClientOptions } from "./client";
import { normalizeDataForSeoTaskResult } from "./normalize";
import type { MarketSource, MarketSourceQuery, MarketSourceResult } from "../market-intelligence/market-source";
import type { HealthCheckResult } from "../types";
import { ConnectorError } from "../types";

export interface DataForSeoGoogleShoppingConnectorOptions extends DataForSeoClientOptions {
  /** Code de localisation Google Ads (ex. 2756 = Suisse) — REQUIS explicitement, jamais deviné/codé en dur ici (voir `docs/market-intelligence-sources.md` pour la valeur retenue et sa source). */
  defaultLocationCode: number;
  defaultLanguageCode?: string;
  /** Code pays ISO utilisé pour renseigner `MarketObservation.country` (déclaratif — n'affecte pas la requête elle-même, qui utilise `defaultLocationCode`). */
  defaultCountry?: string;
  /** Attente maximale totale (ms) avant d'abandonner l'attente du résultat — voir l'en-tête du fichier, cette API n'a pas de mode synchrone. */
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_LANGUAGE_CODE = "en";
const DEFAULT_MAX_WAIT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 1500;

/**
 * Attente entre deux sondages, abandonnable par `signal` (LOT "Interactive
 * History + Generic Result UI + Full Cancellation + Pre-Prod Activation
 * Package", section 6 — "DataForSEO async polling aborts between polls and
 * cancels waiting promptly") — résout IMMÉDIATEMENT dès que le signal
 * externe s'abandonne, jamais après `ms` complet. Le prochain
 * `client.getTask(..., signal)` lève alors lui-même une `ConnectorError`
 * classée `aborted: true` (voir `client.ts`) — cette fonction ne fait que
 * raccourcir l'attente, jamais elle-même la classification de l'abandon.
 */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Connecteur DataForSEO Google Shopping (LOT "Source Wave 3", section 2) —
 * second fournisseur large, indépendant de SerpApi (`../google-shopping/`).
 *
 * **Contrainte technique honnête, structurante pour ce connecteur** :
 * contrairement à SerpApi (un seul aller-retour HTTP synchrone), l'API
 * Merchant de DataForSEO n'a AUCUN mode synchrone pour la recherche de
 * produits — seulement un modèle de tâche asynchrone (`task_post` crée la
 * tâche, `task_get` la lit une fois prête). `search()` fait donc : POST ->
 * sondage borné (`maxWaitMs`, 15s par défaut) -> GET. Si la tâche n'est
 * toujours pas prête à l'expiration du délai, retourne un résultat VIDE
 * (jamais une exception, jamais un résultat partiel présenté comme
 * complet) — l'agrégateur multi-source dégrade déjà gracieusement une
 * source qui ne répond rien (voir `aggregate-market-observations.ts`).
 * Cette latence bornée mais réelle (jusqu'à ~15s) est le compromis honnête
 * face à SerpApi, documenté ici plutôt que masqué.
 */
export function createDataForSeoGoogleShoppingConnector(options: DataForSeoGoogleShoppingConnectorOptions): MarketSource {
  const client = createDataForSeoClient(options);
  const languageCode = options.defaultLanguageCode ?? DEFAULT_LANGUAGE_CODE;
  const country = options.defaultCountry ?? "ch";
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  return {
    source: "dataforseo_google_shopping",
    displayName: "Google Shopping (DataForSEO)",
    supportedCategorySlugs: "any",
    sourceKind: "aggregator",
    evidenceTypes: ["retailPrices", "search"],

    async search(query: MarketSourceQuery): Promise<MarketSourceResult> {
      const collectedAt = new Date().toISOString();

      const posted = await client.postTask(
        {
          keyword: query.q,
          location_code: options.defaultLocationCode,
          language_code: languageCode,
          depth: query.limit,
        },
        query.signal,
      );

      const task = posted.tasks?.[0];
      if (!task || task.status_code >= 40000) {
        throw new ConnectorError(`DataForSEO a refusé la tâche : ${task?.status_message ?? "réponse invalide"}`, { retryable: false });
      }

      const startedAt = Date.now();
      for (;;) {
        const fetched = await client.getTask(task.id, query.signal);
        const fetchedTask = fetched.tasks?.[0];
        if (fetchedTask?.result) {
          const observations = fetchedTask.result.flatMap((result) =>
            normalizeDataForSeoTaskResult(result, { categorySlug: query.categorySlug, query: query.q, country, collectedAt }),
          );
          return { observations, hasMore: undefined };
        }

        if (Date.now() - startedAt >= maxWaitMs) {
          // Jamais une exception ici — une tâche qui n'a pas eu le temps d'aboutir dégrade gracieusement en "aucune observation", exactement comme une source en panne (voir l'en-tête du fichier).
          return { observations: [] };
        }
        // Attente abandonnable (section 6) — si `query.signal` s'abandonne
        // PENDANT cette attente, elle se termine immédiatement ; le
        // `client.getTask` suivant lève alors sa propre `ConnectorError`
        // classée `aborted: true`, jamais un résultat vide qui masquerait
        // une annulation opérateur en "aucune preuve trouvée".
        await abortableSleep(pollIntervalMs, query.signal);
      }
    },

    async healthCheck(): Promise<HealthCheckResult> {
      const checkedAt = new Date().toISOString();
      const startedAt = Date.now();
      try {
        const posted = await client.postTask({ keyword: "test", location_code: options.defaultLocationCode, language_code: languageCode, depth: 1 });
        const task = posted.tasks?.[0];
        if (!task || task.status_code >= 40000) {
          return { status: "down", checkedAt, latencyMs: null, message: task?.status_message ?? "Réponse DataForSEO invalide." };
        }
        return { status: "ok", checkedAt, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          status: "down",
          checkedAt,
          latencyMs: null,
          message: error instanceof ConnectorError ? error.message : "Erreur inconnue lors du contrôle de santé DataForSEO.",
        };
      }
    },
  };
}
