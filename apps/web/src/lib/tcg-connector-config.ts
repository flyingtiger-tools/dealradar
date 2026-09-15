import {
  createFrankfurterProvider,
  createJustTcgPricingConnector,
  createNoopPricingConnector,
  createPokemonTcgCatalogConnector,
  createTcgdexCatalogConnector,
  createTcgdexPricingConnector,
} from "@dealradar/connectors";
import type { TcgPipelineConnectors } from "@dealradar/ingestion";
import { env } from "@/env";

/**
 * Équivalent web (`/api/internal/tcg/analyze`) de `apps/workers/src/
 * ingestion/tcg-connector-config.ts` — même logique exacte, lisant
 * l'environnement Vercel plutôt que Railway. Pokémon TCG API, TCGdex et
 * Frankfurter ne demandent aucune clé (sources gratuites) ; seul JustTCG
 * en a besoin.
 *
 * Contrairement à l'ancienne version côté workers, ne retourne plus jamais
 * `undefined` : JustTCG absent bascule sur un connecteur "vide" (`createNoop
 * PricingConnector`, toujours `[]`) plutôt que de rendre TOUT le pipeline
 * indisponible — l'identification (Pokémon TCG API + TCGdex) et le pricing
 * TCGdex (Cardmarket, gratuit, déjà démontré en direct) restent exploitables
 * sans JustTCG (lot "journée autonome", Priorité 10).
 */
export function buildTcgPipelineConnectorsFromEnv(): TcgPipelineConnectors {
  const justTcgApiKey = env.JUSTTCG_API_KEY;

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
