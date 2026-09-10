import type { WebFetchRequest, WebFetchResult, WebMarketplaceFetcher } from "./types";
import { WebFetchError } from "./types";

/**
 * Implémentation factice de `WebMarketplaceFetcher` pour les tests d'un
 * futur connecteur (RicardoConnector/AnibisConnector) sans dépendre de
 * Scrapling ni d'aucun accès réseau — même esprit que
 * `packages/benchmark/src/provider/simulated.ts` pour l'IA. Ne lance jamais
 * de navigateur, ne contacte jamais un vrai site.
 */
export function createMockWebMarketplaceFetcher(responses: Record<string, WebFetchResult | WebFetchError>): WebMarketplaceFetcher {
  return {
    async fetch(request: WebFetchRequest): Promise<WebFetchResult> {
      const response = responses[request.url];
      if (!response) {
        throw new WebFetchError(`Aucune réponse simulée configurée pour ${request.url}.`);
      }
      if (response instanceof WebFetchError) throw response;
      return response;
    },
  };
}
