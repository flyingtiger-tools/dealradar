import {
  createFrankfurterProvider,
  createJustTcgPricingConnector,
  createPokemonTcgCatalogConnector,
  createTcgdexCatalogConnector,
  createTcgdexPricingConnector,
} from "@dealradar/connectors";
import type { TcgPipelineConnectors } from "@dealradar/ingestion";

export type { TcgPipelineConnectors };

/**
 * Connecteurs du pipeline Pokémon (ADR 0012, LOT 3-7C) construits depuis
 * l'environnement des workers — même convention que
 * `connector-config.ts` (eBay) et `ai-provider-config.ts`. Pokémon TCG API,
 * TCGdex et Frankfurter ne demandent aucune clé (sources gratuites du MVP,
 * voir `docs/external-data-sources.md`) ; seul JustTCG en a besoin.
 *
 * `TcgPipelineConnectors` (le type) vit maintenant dans `@dealradar/ingestion`
 * (déplacé avec `processTcgCardAnalysis` — lot "journée autonome") : cette
 * fonction de wiring reste ici, spécifique à l'environnement des workers, et
 * est réutilisable telle quelle par tout appelant Node standard.
 */

/** Retourne `undefined` (jamais une erreur) si `JUSTTCG_API_KEY` est absent — dégradation gracieuse, même esprit que `buildAiExtractionConfigFromEnv`. */
export function buildTcgPipelineConnectorsFromEnv(): TcgPipelineConnectors | undefined {
  const justTcgApiKey = process.env.JUSTTCG_API_KEY;
  if (!justTcgApiKey) return undefined;

  return {
    pokemonCatalogConnector: createPokemonTcgCatalogConnector({}),
    tcgdexCatalogConnector: createTcgdexCatalogConnector({}),
    justTcgPricingConnector: createJustTcgPricingConnector({ apiKey: justTcgApiKey }),
    tcgdexPricingConnector: createTcgdexPricingConnector({}),
    fxProvider: createFrankfurterProvider({}),
  };
}
