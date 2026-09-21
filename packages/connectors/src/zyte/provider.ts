import { createZyteClient, type ZyteClientOptions } from "./client";
import { ScrapeError, type ScrapeRequest, type ScrapeResult, type ScrapingProvider } from "../market-intelligence/scraping-provider";
import { ConnectorError } from "../types";

export interface ZyteScrapingProviderOptions extends ZyteClientOptions {}

/**
 * Implémentation `ScrapingProvider` pour Zyte (LOT "Source Wave 2", section
 * 4) — premier fournisseur de scraping géré réellement câblé. Choisi parmi
 * Zyte/Bright Data/Apify/Oxylabs (voir `docs/market-intelligence-
 * sources.md` pour la comparaison) : une seule clé API (pas de paire
 * login/mot de passe comme DataForSEO), API REST simple bien documentée
 * (`POST /v1/extract`), rendu JS optionnel géré côté vendeur (`browserHtml`),
 * géociblage par pays, et Zyte gère lui-même la gestion anti-bot/proxy —
 * DealRadar ne fait QUE traduire ce contrat, aucune logique de contournement
 * n'est ajoutée ici (règle absolue du lot).
 *
 * `extractedFields` reste TOUJOURS vide ici : ce provider ne fait QUE la
 * récupération de page (générique, jamais spécifique à une marketplace) —
 * l'extraction structurée (titre/prix/etc.) est la responsabilité d'un
 * parser dédié en aval (voir `../ricardo/parse.ts`), jamais de ce fichier
 * (séparation explicite exigée par le lot : "keep fetching vendor-specific
 * outside marketplace parsing").
 */
export function createZyteScrapingProvider(options: ZyteScrapingProviderOptions): ScrapingProvider {
  const client = createZyteClient(options);

  return {
    name: "zyte",

    async scrape(request: ScrapeRequest): Promise<ScrapeResult> {
      const startedAt = Date.now();
      const usedJsRendering = request.renderJs ?? false;

      try {
        const response = usedJsRendering
          ? await client.extract({ url: request.url, browserHtml: true, geolocation: request.country }, request.signal)
          : await client.extract({ url: request.url, httpResponseBody: true, geolocation: request.country }, request.signal);

        const rawHtml = response.browserHtml ?? (response.httpResponseBody ? Buffer.from(response.httpResponseBody, "base64").toString("utf-8") : null);

        return {
          url: request.url,
          fetchedAt: new Date().toISOString(),
          rawHtml,
          // Ce provider générique ne produit jamais de champs extraits structurés — voir l'en-tête du fichier.
          extractedFields: {},
          diagnostics: {
            provider: "zyte",
            latencyMs: Date.now() - startedAt,
            // Zyte n'expose pas de coût par requête dans la réponse de `/v1/extract` — jamais un coût inventé (voir `ScrapeDiagnostics.estimatedCostUsd`, doc : `null` si non exposé).
            estimatedCostUsd: null,
            usedJsRendering,
            httpStatus: response.statusCode ?? null,
          },
        };
      } catch (error) {
        if (error instanceof ConnectorError) {
          // Un abandon par le signal EXTERNE est terminal et jamais une panne
          // fournisseur — vérifié EN PREMIER, avant toute classification par
          // code HTTP (voir `ConnectorError.aborted`, même discipline que les
          // autres clients du paquet).
          if (error.aborted) throw new ScrapeError(error.message, { reason: "provider_error", retryable: false, aborted: true });
          if (error.httpStatus === 429) throw new ScrapeError(error.message, { reason: "timeout", retryable: true });
          if (error.httpStatus === 404 || error.httpStatus === 521) throw new ScrapeError(error.message, { reason: "not_found", retryable: false });
          if (error.httpStatus === 400) throw new ScrapeError(error.message, { reason: "invalid_request", retryable: false });
          throw new ScrapeError(error.message, { reason: "provider_error", retryable: error.retryable });
        }
        throw new ScrapeError(error instanceof Error ? error.message : "Erreur Zyte inconnue.", { reason: "provider_error" });
      }
    },
  };
}
