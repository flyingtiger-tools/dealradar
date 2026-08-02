import {
  createFrankfurterProvider,
  createJustTcgPricingConnector,
  createPokemonTcgCatalogConnector,
  createTcgdexCatalogConnector,
  createTcgdexPricingConnector,
  type CatalogConnector,
  type FxRateProvider,
  type PricingConnector,
} from "@dealradar/connectors";

/**
 * Connecteurs du pipeline Pokémon (ADR 0012, LOT 3-7C) construits depuis
 * l'environnement des workers — même convention que
 * `connector-config.ts` (eBay) et `ai-provider-config.ts`. Pokémon TCG API,
 * TCGdex et Frankfurter ne demandent aucune clé (sources gratuites du MVP,
 * voir `docs/external-data-sources.md`) ; seul JustTCG en a besoin.
 */
export interface TcgPipelineConnectors {
  pokemonCatalogConnector: CatalogConnector;
  tcgdexCatalogConnector: CatalogConnector;
  justTcgPricingConnector: PricingConnector;
  tcgdexPricingConnector: PricingConnector;
  fxProvider: FxRateProvider;
}

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
