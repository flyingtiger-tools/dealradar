import {
  createFrankfurterProvider,
  createJustTcgPricingConnector,
  createNoopPricingConnector,
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
 *
 * Ne retourne plus jamais `undefined` (lot "journée autonome", même
 * correctif que la version web) : JustTCG absent bascule sur un connecteur
 * "vide" plutôt que de rendre tout le pipeline indisponible — Pokémon TCG
 * API + TCGdex (identification ET pricing, tous deux gratuits) restent
 * exploitables sans JustTCG.
 */
export function buildTcgPipelineConnectorsFromEnv(): TcgPipelineConnectors {
  const justTcgApiKey = process.env.JUSTTCG_API_KEY;

  return {
    pokemonCatalogConnector: createPokemonTcgCatalogConnector({}),
    tcgdexCatalogConnector: createTcgdexCatalogConnector({}),
    justTcgPricingConnector: justTcgApiKey
      ? createJustTcgPricingConnector({ apiKey: justTcgApiKey })
      : createNoopPricingConnector("justtcg", "JUSTTCG_API_KEY absent — source ignorée, jamais un échec du pipeline entier."),
    tcgdexPricingConnector: createTcgdexPricingConnector({}),
    fxProvider: createFrankfurterProvider({}),
  };
}
